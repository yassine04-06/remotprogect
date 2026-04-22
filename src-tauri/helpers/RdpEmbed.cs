using System;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Drawing;

namespace RdpEmbed
{
    class RdpAxHost : AxHost
    {
        public RdpAxHost(string clsid) : base(clsid) { }

        public static RdpAxHost Create()
        {
            // Try latest to oldest MsRdpClient NotSafeForScripting CLSIDs
            string[] clsids = {
                "{A0C63C30-F08D-4AB4-907C-34905D770C7D}", // MsRdpClient10
                "{8B918B82-7985-4C24-89DF-C33AD2BBFBCD}", // MsRdpClient9
                "{4EDCB26C-D24C-4E72-AF07-B576699AC0DE}", // MsRdpClient8
                "{7584C670-2274-4EFB-B00B-D6AABA6D3850}", // MsRdpClient7
                "{4EB89FF4-7F78-4A0F-8B8D-2BF02E94E4B2}", // MsRdpClient6
                "{4EB2F086-C818-447E-B32C-C51CE2B30D31}", // MsRdpClient5
            };

            foreach (var clsid in clsids)
            {
                try
                {
                    var host = new RdpAxHost(clsid);
                    return host;
                }
                catch { continue; }
            }

            // Last resort: try ProgID
            Type t = Type.GetTypeFromProgID("MsTscAx.MsTscAx");
            if (t != null)
                return new RdpAxHost(t.GUID.ToString("B"));

            throw new Exception("No RDP ActiveX control found on this system.");
        }
    }

    class RdpForm : Form
    {
        private RdpAxHost rdpHost;
        private dynamic rdpClient;
        private Thread stdinThread;
        private bool running = true;

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

        [DllImport("user32.dll")]
        static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll")]
        static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")]
        private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

        [DllImport("user32.dll")]
        static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern IntPtr SetFocus(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool BringWindowToTop(IntPtr hWnd);

        const int GWL_STYLE = -16;
        const int GWL_EXSTYLE = -20;
        const int WS_CHILD = 0x40000000;
        const int WS_VISIBLE = 0x10000000;
        const int WS_CAPTION = 0x00C00000;
        const int WS_THICKFRAME = 0x00040000;
        const int WS_SYSMENU = 0x00080000;
        const int WS_POPUP = unchecked((int)0x80000000);

        private int m_x, m_y, m_w, m_h;

        public RdpForm(string host, int port, string username, string password,
                       long parentHwnd, int posX, int posY, int posW, int posH)
        {
            m_x = posX; m_y = posY; m_w = posW; m_h = posH;
            this.FormBorderStyle = FormBorderStyle.None;
            this.ShowInTaskbar = false;
            this.ControlBox = false;
            this.Text = "";
            this.StartPosition = FormStartPosition.Manual;
            this.Location = new Point(posX, posY);
            this.Size = new Size(posW, posH);
            this.BackColor = Color.Black;

            try
            {
                rdpHost = RdpAxHost.Create();
                ((System.ComponentModel.ISupportInitialize)rdpHost).BeginInit();
                rdpHost.Dock = DockStyle.Fill;
                this.Controls.Add(rdpHost);
                ((System.ComponentModel.ISupportInitialize)rdpHost).EndInit();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("INIT_ERROR:" + ex.Message);
                Console.Error.Flush();
                Environment.Exit(1);
            }

            this.Shown += (s, e) =>
            {
                try
                {
                    rdpClient = rdpHost.GetOcx();

                    // Connection settings
                    rdpClient.Server = host;
                    
                    if (username.Contains("\\"))
                    {
                        var parts = username.Split(new char[] { '\\' }, 2);
                        rdpClient.Domain = parts[0];
                        rdpClient.UserName = parts[1];
                    }
                    else
                    {
                        rdpClient.UserName = username;
                    }

                    try { rdpClient.AdvancedSettings9.RDPPort = port; }
                    catch { try { rdpClient.AdvancedSettings7.RDPPort = port; } catch { } }

                    try { rdpClient.AdvancedSettings9.ClearTextPassword = password; }
                    catch { try { rdpClient.AdvancedSettings7.ClearTextPassword = password; } catch { } }

                    try { rdpClient.AdvancedSettings9.EnableCredSspSupport = true; } catch { }
                    
                    // 0 = No authentication, 2 = Warn but allow, 3 = Do not authenticate (usually we want 2 or 0)
                    try { rdpClient.AdvancedSettings9.AuthenticationLevel = 2; } catch { }
                    
                    // Security settings to bypass cert prompts which can cause black screen hangs
                    try { rdpClient.AdvancedSettings9.NegotiateSecurityLayer = true; } catch { }
                    try { rdpClient.SecuredSettings3.StartProgram = ""; } catch { }
                    try { ((dynamic)rdpClient.AdvancedSettings8).NetworkConnectionType = 6; } catch { } // LAN

                    // Ignore certificate warnings
                    try { rdpClient.AdvancedSettings8.AuthenticationLevel = 0; } catch { }

                    // Display settings
                    rdpClient.DesktopWidth = this.ClientSize.Width;
                    rdpClient.DesktopHeight = this.ClientSize.Height;
                    
                    // Enable SmartSizing aggressively to prevent scrollbars
                    try { ((dynamic)rdpClient.AdvancedSettings2).SmartSizing = true; } catch { }
                    try { ((dynamic)rdpClient.AdvancedSettings7).SmartSizing = true; } catch { }
                    try { ((dynamic)rdpClient.AdvancedSettings8).SmartSizing = true; } catch { }
                    try { ((dynamic)rdpClient.AdvancedSettings9).SmartSizing = true; } catch { }

                    rdpClient.FullScreen = false;
                    rdpClient.ColorDepth = 32;

                    // Reparent into the Tauri window
                    if (parentHwnd != 0)
                    {
                        IntPtr parent = new IntPtr(parentHwnd);
                        int style = GetWindowLong(this.Handle, GWL_STYLE);
                        style &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU);
                        style |= WS_POPUP | WS_VISIBLE;
                        SetWindowLong(this.Handle, GWL_STYLE, style);
                        
                        // Set owner (keeps it on top of Tauri) instead of parent (fixes black screen)
                        const int GWLP_HWNDPARENT = -8;
                        if (IntPtr.Size == 8) {
                            SetWindowLongPtr(this.Handle, GWLP_HWNDPARENT, parent);
                        } else {
                            SetWindowLong(this.Handle, GWLP_HWNDPARENT, parent.ToInt32());
                        }
                        
                        MoveWindow(this.Handle, posX, posY, posW, posH, true);
                    }

                    // Output HWND for the Tauri backend to track
                    Console.WriteLine("HWND:" + this.Handle.ToInt64());
                    Console.Out.Flush();

                    // Listen for resize commands on stdin
                    stdinThread = new Thread(ReadStdin);
                    stdinThread.IsBackground = true;
                    stdinThread.Start();

                    // Handle events - EXACT RESTORE with WriteLine replacing MessageBox
                    try
                    {
                        rdpClient.OnWarning += new EventHandler<dynamic>((sender, ev) =>
                        {
                            Console.WriteLine("EVENT:warning:" + ev.warningCode);
                            Console.Out.Flush();
                        });
                        rdpClient.OnFatalError += new EventHandler<dynamic>((sender, ev) =>
                        {
                            Console.WriteLine("EVENT:fatal:" + ev.errorCode);
                            Console.Out.Flush();
                        });
                        rdpClient.OnDisconnected += new EventHandler<dynamic>((sender, ev) =>
                        {
                            Console.WriteLine("EVENT:disconnected:" + ev.discReason);
                            Console.Out.Flush();
                        });
                    }
                    catch { }

                    rdpClient.Connect();
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("CONNECT_ERROR:" + ex.Message);
                    Console.Error.Flush();
                    this.Close();
                }
            };

            this.FormClosed += (s, e) =>
            {
                running = false;
                try
                {
                    if (rdpClient != null)
                    {
                        try { rdpClient.Disconnect(); } catch { }
                    }
                }
                catch { }
                Console.WriteLine("CLOSED");
                Console.Out.Flush();
            };
        }

        private void ReadStdin()
        {
            try
            {
                while (running)
                {
                    string line = Console.ReadLine();
                    if (line == null)
                    {
                        // Handle EOF: the parent Tauri process died or forcefully closed our pipe.
                        // We must self-destruct immediately to avoid leaving orphaned floating windows.
                        try { this.Invoke((MethodInvoker)delegate { this.Close(); }); } catch { }
                        Environment.Exit(0);
                        break;
                    }

                    line = line.Trim();
                    if (line.StartsWith("RESIZE:"))
                    {
                        // Format: RESIZE:x,y,w,h
                        var parts = line.Substring(7).Split(',');
                        if (parts.Length == 4)
                        {
                            int x = int.Parse(parts[0]);
                            int y = int.Parse(parts[1]);
                            int w = int.Parse(parts[2]);
                            int h = int.Parse(parts[3]);
                            m_x = x; m_y = y; m_w = w; m_h = h;
                            this.Invoke((MethodInvoker)delegate
                            {
                                MoveWindow(this.Handle, x, y, w, h, true);
                            });
                        }
                    }
                    else if (line == "HIDE")
                    {
                        this.Invoke((MethodInvoker)delegate { ShowWindow(this.Handle, 0); });
                    }
                    else if (line == "SHOW")
                    {
                        this.Invoke((MethodInvoker)delegate { 
                            ShowWindow(this.Handle, 5); 
                            MoveWindow(this.Handle, m_x, m_y, m_w, m_h, true);
                        });
                    }
                    else if (line == "FOCUS")
                    {
                        this.Invoke((MethodInvoker)delegate { 
                            BringWindowToTop(this.Handle); 
                            SetForegroundWindow(this.Handle);
                            if (rdpHost != null) SetFocus(rdpHost.Handle);
                        });
                    }
                    else if (line.StartsWith("CMD:"))
                    {
                        string cmd = line.Substring(4);
                        if (cmd == "CTRLALTDEL")
                        {
                            this.Invoke((MethodInvoker)delegate {
                                BringWindowToTop(this.Handle); 
                                SetForegroundWindow(this.Handle);
                                if (rdpHost != null) SetFocus(rdpHost.Handle);
                                SendKeys.SendWait("^%{END}");
                            });
                        }
                        else if (cmd.StartsWith("SCALING:"))
                        {
                            bool fit = cmd.Substring(8) == "FIT";
                            this.Invoke((MethodInvoker)delegate {
                                try { ((dynamic)rdpClient.AdvancedSettings2).SmartSizing = fit; } catch { }
                                try { ((dynamic)rdpClient.AdvancedSettings7).SmartSizing = fit; } catch { }
                                try { ((dynamic)rdpClient.AdvancedSettings8).SmartSizing = fit; } catch { }
                                try { ((dynamic)rdpClient.AdvancedSettings9).SmartSizing = fit; } catch { }
                            });
                        }
                    }
                    else if (line == "CLOSE")
                    {
                        this.Invoke((MethodInvoker)delegate { this.Close(); });
                        break;
                    }
                    else if (line == "PING")
                    {
                        Console.WriteLine("PONG");
                        Console.Out.Flush();
                    }
                }
            }
            catch 
            { 
                try { this.Invoke((MethodInvoker)delegate { this.Close(); }); } catch { }
                Environment.Exit(0);
            }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.Style &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU);
                return cp;
            }
        }
    }

    class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            if (args.Length < 8)
            {
                Console.Error.WriteLine(
                    "Usage: RdpEmbed.exe <host> <port> <user> <pass> <parent_hwnd> <x> <y> <w> <h>");
                Environment.Exit(1);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string host = args[0];
            int port = int.Parse(args[1]);
            string user = args[2];
            string pass = args[3];
            long parentHwnd = long.Parse(args[4]);
            int px = int.Parse(args[5]);
            int py = int.Parse(args[6]);
            int pw = int.Parse(args[7]);
            int ph = args.Length > 8 ? int.Parse(args[8]) : 600;

            try
            {
                var form = new RdpForm(host, port, user, pass, parentHwnd, px, py, pw, ph);
                Console.WriteLine("READY");
                Console.Out.Flush();
                Application.Run(form);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("FATAL:" + ex.Message);
                Console.Error.Flush();
                Environment.Exit(1);
            }
        }
    }
}
