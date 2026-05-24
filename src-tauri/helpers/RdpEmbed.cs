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
                try { return new RdpAxHost(clsid); }
                catch { continue; }
            }

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
        private Thread trackThread;
        private bool running = true;
        private bool isVisible = false;
        private readonly IntPtr _parentHwnd;

        // ── Win32 P/Invoke ────────────────────────────────────────────────────

        [DllImport("user32.dll")]
        static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll")]
        static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")]
        private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

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

        // Returns the bounding box of a window in screen coordinates.
        [DllImport("user32.dll")]
        static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        // Returns the client-area bounding box (always in physical pixels under
        // Per-Monitor V2 DPI awareness, unlike WinForms Form.ClientSize which may
        // return DPI-scaled logical units on older .NET Framework versions).
        [DllImport("user32.dll")]
        static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

        [StructLayout(LayoutKind.Sequential)]
        struct RECT { public int Left, Top, Right, Bottom; }

        const int GWL_STYLE      = -16;
        const int GWLP_HWNDPARENT = -8;
        const int WS_CAPTION     = 0x00C00000;
        const int WS_THICKFRAME  = 0x00040000;
        const int WS_SYSMENU     = 0x00080000;
        const int WS_VISIBLE     = 0x10000000;
        const int WS_POPUP = unchecked((int)0x80000000);

        // ── Position state ───────────────────────────────────────────────────
        //
        // m_sx / m_sy  — screen coordinates of the RDP window as of the last
        //                RESIZE command (set by Rust/Tauri, already correct).
        // m_px / m_py  — screen coordinates of the PARENT window's outer rect
        //                (GetWindowRect) at that same moment.
        //                The tracker re-reads the parent rect every 8 ms and
        //                applies any delta to m_sx/m_sy without an IPC round-trip.
        // m_w  / m_h   — current RDP window dimensions in screen pixels.
        //
        // All values are in PHYSICAL screen pixels (absolute, monitor-independent).
        // Using absolute coordinates means the TrackParent thread naturally follows
        // the parent across monitors with different DPI — no DPI knowledge needed.

        private volatile int m_sx, m_sy, m_w, m_h;
        private volatile int m_px, m_py; // parent rect.Left / rect.Top at last RESIZE

        // TrackParent working state — volatile so the UI thread (BeginInvoke lambda)
        // always reads the freshest values even without an explicit memory barrier.
        private volatile int m_trackX, m_trackY;

        // ── Debounced remote-resolution update ───────────────────────────────
        //
        // UpdateSessionDisplaySettings sends a display-change request to the
        // remote server and involves a full network round-trip.  Calling it on
        // every RESIZE event floods the server and causes a multi-second lag
        // while queued requests drain.  Instead we fire it once, 150 ms after
        // the last RESIZE — by which point the user has typically stopped
        // dragging the window edge.  The form and AxHost are still resized
        // immediately on every RESIZE for a smooth local experience.
        private System.Windows.Forms.Timer m_resizeDebounce;
        private volatile int m_pendingW, m_pendingH;

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.Style &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU);
                return cp;
            }
        }

        public RdpForm(string host, int port, string username, string password,
                       long parentHwnd, int posX, int posY, int posW, int posH)
        {
            _parentHwnd = new IntPtr(parentHwnd);

            // posX/posY are -32000 (off-screen placeholder); posW/posH = initial RDP desktop size
            m_sx = posX; m_sy = posY; m_w = posW; m_h = posH;
            m_px = 0;    m_py = 0;

            // Debounce timer for UpdateSessionDisplaySettings (UI thread — safe to
            // call rdpClient from Tick without Invoke).
            m_resizeDebounce = new System.Windows.Forms.Timer();
            m_resizeDebounce.Interval = 80; // ms of silence after last RESIZE
            m_resizeDebounce.Tick += (s, e) =>
            {
                m_resizeDebounce.Stop();
                if (rdpClient == null) return;
                int w = m_pendingW;
                int h = m_pendingH;
                // Guard: reject resolutions below 100×100.  These occur during
                // OS window minimize (client area → 0×0) or brief layout
                // transitions.  UpdateSessionDisplaySettings with a 1×1 (or any
                // sub-100) resolution can cause the RDP server to drop the session.
                if (w < 100 || h < 100) return;
                try
                {
                    rdpClient.UpdateSessionDisplaySettings(
                        (uint)w, (uint)h,
                        (uint)w, (uint)h,
                        0u, 100u, 100u);
                }
                catch { }
            };

            // CRITICAL: disable WinForms DPI auto-scaling BEFORE setting Size.
            // Default AutoScaleMode (Font) multiplies every logical Size value by
            // the DPI factor (e.g. 800 → 1000 at 125 %).  With AutoScaleMode.None,
            // the WinForms Size property is treated as physical pixels — exactly
            // what posW/posH contain (React CSS px × devicePixelRatio).
            this.AutoScaleMode   = AutoScaleMode.None;
            this.FormBorderStyle = FormBorderStyle.None;
            this.ShowInTaskbar   = false;
            this.ControlBox      = false;
            this.Text            = "";
            this.StartPosition   = FormStartPosition.Manual;
            this.Location        = new Point(-32000, -32000);
            // posW/posH are physical pixels (React rect × devicePixelRatio).
            // AutoScaleMode.None means WinForms will NOT DPI-scale these further.
            this.Size            = new Size(posW, posH);
            this.BackColor       = Color.Black;

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
                    // ── Step 1: Apply WS_POPUP + parent HWND FIRST ──────────
                    //
                    // SetWindowLong(WS_POPUP) can trigger WM_NCCALCSIZE and a
                    // WinForms DPI re-layout.  We do this BEFORE MoveWindow so
                    // that any automatic resize WinForms applies happens on the
                    // small off-screen placeholder, not on the final position.
                    // After SetWindowLong, MoveWindow is authoritative.
                    if (_parentHwnd != IntPtr.Zero)
                    {
                        int style = GetWindowLong(this.Handle, GWL_STYLE);
                        style &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU);
                        style |= WS_POPUP | WS_VISIBLE;
                        SetWindowLong(this.Handle, GWL_STYLE, style);

                        if (IntPtr.Size == 8)
                            SetWindowLongPtr64(this.Handle, GWLP_HWNDPARENT, _parentHwnd);
                        else
                            SetWindowLong(this.Handle, GWLP_HWNDPARENT, _parentHwnd.ToInt32());
                    }

                    // ── Step 2: Force physical size via Win32 ────────────────
                    //
                    // AutoScaleMode.None means the WinForms Size property already
                    // set posW×posH as physical pixels in the constructor.  We still
                    // call MoveWindow explicitly here so that if any re-layout fired
                    // during SetWindowLong changed the size, we correct it before
                    // reading the client rect and passing it to the RDP ActiveX.
                    MoveWindow(this.Handle, -32000, -32000, m_w, m_h, false);

                    // ── Step 3: Read physical client area ────────────────────
                    //
                    // GetClientRect is always in physical pixels under Per-Monitor
                    // V2 DPI awareness.  The client area may be slightly smaller
                    // than m_w × m_h if WinForms added a non-client border, so we
                    // measure it directly instead of using m_w/m_h verbatim.
                    RECT cr;
                    int physW = m_w;
                    int physH = m_h;
                    if (GetClientRect(this.Handle, out cr))
                    {
                        physW = Math.Max(cr.Right  - cr.Left, 1);
                        physH = Math.Max(cr.Bottom - cr.Top,  1);
                    }

                    rdpClient = rdpHost.GetOcx();

                    // ── Connection settings ──────────────────────────────────
                    rdpClient.Server = host;

                    if (username.Contains("\\"))
                    {
                        var parts = username.Split(new char[] { '\\' }, 2);
                        rdpClient.Domain   = parts[0];
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

                    try { rdpClient.AdvancedSettings9.EnableCredSspSupport   = true; } catch { }
                    try { rdpClient.AdvancedSettings9.AuthenticationLevel    = 2;    } catch { }
                    try { rdpClient.AdvancedSettings9.NegotiateSecurityLayer = true; } catch { }
                    try { rdpClient.SecuredSettings3.StartProgram            = "";   } catch { }
                    try { ((dynamic)rdpClient.AdvancedSettings8).NetworkConnectionType = 6; } catch { }
                    try { rdpClient.AdvancedSettings8.AuthenticationLevel = 0; } catch { }

                    // ── Step 4: Set desktop resolution = physical client area ─
                    //
                    // physW/physH are the actual physical client pixels after all
                    // WinForms/Win32 layout is settled.  Setting DesktopWidth to
                    // exactly this value means the remote desktop is rendered at
                    // 1:1 physical pixels — no SmartSizing upscale, no margins.
                    rdpClient.DesktopWidth  = physW;
                    rdpClient.DesktopHeight = physH;

                    // SmartSizing is still enabled as a fallback for subsequent
                    // MoveWindow resizes (DesktopWidth cannot change after Connect).
                    try { ((dynamic)rdpClient.AdvancedSettings2).SmartSizing = true; } catch { }
                    try { ((dynamic)rdpClient.AdvancedSettings7).SmartSizing = true; } catch { }
                    try { ((dynamic)rdpClient.AdvancedSettings8).SmartSizing = true; } catch { }
                    try { ((dynamic)rdpClient.AdvancedSettings9).SmartSizing = true; } catch { }

                    rdpClient.FullScreen = false;
                    rdpClient.ColorDepth = 32;

                    // Report HWND to the Rust backend.
                    Console.WriteLine("HWND:" + this.Handle.ToInt64());
                    Console.Out.Flush();

                    isVisible = true;

                    // ── Stdin command loop ───────────────────────────────────
                    stdinThread = new Thread(ReadStdin) { IsBackground = true };
                    stdinThread.Start();

                    // ── Parent-tracking thread ───────────────────────────────
                    // Polls the Tauri window position at ~120 fps.  When the
                    // parent moves, it applies the same delta to the RDP window
                    // instantly — no React/Rust/IPC round-trip needed.
                    trackThread = new Thread(TrackParent) { IsBackground = true };
                    trackThread.Start();

                    // ── RDP event callbacks ──────────────────────────────────
                    try
                    {
                        rdpClient.OnWarning += new EventHandler<dynamic>((sender2, ev) =>
                        {
                            Console.WriteLine("EVENT:warning:" + ev.warningCode);
                            Console.Out.Flush();
                        });
                        rdpClient.OnFatalError += new EventHandler<dynamic>((sender2, ev) =>
                        {
                            Console.WriteLine("EVENT:fatal:" + ev.errorCode);
                            Console.Out.Flush();
                        });
                        rdpClient.OnDisconnected += new EventHandler<dynamic>((sender2, ev) =>
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
                try { m_resizeDebounce.Stop(); m_resizeDebounce.Dispose(); } catch { }
                try
                {
                    if (rdpClient != null)
                        try { rdpClient.Disconnect(); } catch { }
                }
                catch { }
                Console.WriteLine("CLOSED");
                Console.Out.Flush();
            };
        }

        // ── Parent tracking ───────────────────────────────────────────────────
        //
        // Every ~8 ms the tracker reads the Tauri window's RECT via GetWindowRect.
        // If the window moved since the last RESIZE command, it computes the delta
        // and adds it to the stored RDP screen position (m_sx / m_sy), then calls
        // MoveWindow.  This makes the RDP popup follow drag/resize of the Tauri
        // window at ~120 fps without any IPC overhead.

        // ── Parent tracking ───────────────────────────────────────────────────
        //
        // Polls the Tauri window HWND position every ~8 ms via GetWindowRect
        // (physical screen pixels, absolute, monitor-independent).  When the
        // parent moves — including dragging across monitors with different DPI —
        // it applies the same pixel delta to the RDP window without any IPC
        // round-trip.  The absolute-coordinate approach means no DPI knowledge
        // is required here; all values are in the same coordinate space.
        //
        // Race-condition fix: the previous code stored newX/newY in non-volatile
        // fields that the BeginInvoke lambda read by reference.  Between the time
        // the background thread wrote them and the UI thread executed the delegate,
        // the background thread could have overwritten them with different values —
        // causing the window to jump to an unexpected position.  We now snapshot
        // all values into locals BEFORE BeginInvoke so the delegate is self-contained.

        private void TrackParent()
        {
            int prevX = m_sx;
            int prevY = m_sy;

            while (running)
            {
                try
                {
                    if (isVisible && _parentHwnd != IntPtr.Zero)
                    {
                        RECT rect;
                        if (GetWindowRect(_parentHwnd, out rect))
                        {
                            // Delta from the anchor set by the last RESIZE command.
                            // Both rect.Left/Top and m_px/m_py are absolute physical
                            // screen pixels, so the delta is valid across monitors.
                            int dx = rect.Left - m_px;
                            int dy = rect.Top  - m_py;

                            int newX = m_sx + dx;
                            int newY = m_sy + dy;

                            if (newX != prevX || newY != prevY)
                            {
                                prevX = newX;
                                prevY = newY;

                                // Snapshot all values so the delegate is independent
                                // of any subsequent writes by this thread.
                                int snapX = newX;
                                int snapY = newY;
                                int snapW = m_w;
                                int snapH = m_h;

                                // Update volatile tracking fields so the SHOW handler
                                // can read the latest position without recalculating.
                                m_trackX = snapX;
                                m_trackY = snapY;

                                this.BeginInvoke((MethodInvoker)delegate
                                {
                                    if (isVisible)
                                        MoveWindow(this.Handle, snapX, snapY, snapW, snapH, false);
                                });
                            }
                        }
                    }
                }
                catch { }

                Thread.Sleep(8);
            }
        }

        // ── Stdin command loop ─────────────────────────────────────────────────

        private void ReadStdin()
        {
            try
            {
                while (running)
                {
                    string line = Console.ReadLine();
                    if (line == null)
                    {
                        // Parent closed the pipe — self-destruct.
                        try { this.Invoke((MethodInvoker)delegate { this.Close(); }); } catch { }
                        Environment.Exit(0);
                        break;
                    }

                    line = line.Trim();

                    if (line.StartsWith("RESIZE:"))
                    {
                        // Format: RESIZE:screen_x,screen_y,w,h  (physical screen pixels)
                        var parts = line.Substring(7).Split(',');
                        if (parts.Length == 4)
                        {
                            int sx = int.Parse(parts[0]);
                            int sy = int.Parse(parts[1]);
                            int sw = int.Parse(parts[2]);
                            int sh = int.Parse(parts[3]);

                            // Guard: ignore resize commands with near-zero dimensions.
                            // The React side already suppresses these, but defend here
                            // too in case of any race condition.  A sub-100 resize would
                            // resize rdpHost to 1×1 and then fire
                            // UpdateSessionDisplaySettings(1,1) — which disconnects the
                            // remote session on most servers.
                            if (sw < 100 || sh < 100)
                            {
                                // Cancel any in-flight debounce so it does not apply a
                                // bad resolution when it fires.
                                this.Invoke((MethodInvoker)delegate { m_resizeDebounce.Stop(); });
                                continue;
                            }

                            // Record parent position at this moment as the anchor.
                            RECT rect;
                            if (_parentHwnd != IntPtr.Zero && GetWindowRect(_parentHwnd, out rect))
                            {
                                m_px = rect.Left;
                                m_py = rect.Top;
                            }

                            m_sx = sx; m_sy = sy; m_w = sw; m_h = sh;

                            this.Invoke((MethodInvoker)delegate
                            {
                                // 1. Resize the outer form to the new screen position/size.
                                MoveWindow(this.Handle, sx, sy, sw, sh, true);

                                // 2. Read physical client area and resize the AxHost immediately.
                                //    This is instant — no network involved.
                                RECT cr;
                                if (!GetClientRect(this.Handle, out cr)) return;
                                int cw = Math.Max(cr.Right  - cr.Left, 1);
                                int ch = Math.Max(cr.Bottom - cr.Top,  1);
                                if (rdpHost != null)
                                    MoveWindow(rdpHost.Handle, 0, 0, cw, ch, true);

                                // 3. Schedule a debounced remote-resolution update.
                                //    UpdateSessionDisplaySettings involves a full network
                                //    round-trip; calling it on every resize event would
                                //    queue dozens of requests and cause a multi-second lag.
                                //    We reset the 150 ms timer on every RESIZE so the
                                //    actual RPC fires only once the user stops dragging.
                                m_pendingW = cw;
                                m_pendingH = ch;
                                m_resizeDebounce.Stop();
                                m_resizeDebounce.Start();
                            });
                        }
                    }
                    else if (line == "HIDE")
                    {
                        this.Invoke((MethodInvoker)delegate
                        {
                            isVisible = false;
                            ShowWindow(this.Handle, 0);
                        });
                    }
                    else if (line == "SHOW")
                    {
                        this.Invoke((MethodInvoker)delegate
                        {
                            // Use the most recent tracked position (m_trackX/Y) which
                            // the TrackParent thread keeps updated every 8 ms.  This
                            // means the window appears at the correct location even if
                            // the parent moved or changed monitor while this tab was
                            // hidden — no stale-anchor jump on reattach.
                            int showX, showY;
                            if (m_trackX != 0 || m_trackY != 0)
                            {
                                showX = m_trackX;
                                showY = m_trackY;
                            }
                            else
                            {
                                // TrackParent hasn't run yet — fallback: recompute
                                // from anchor + current parent delta.
                                RECT rect;
                                if (_parentHwnd != IntPtr.Zero && GetWindowRect(_parentHwnd, out rect))
                                {
                                    showX = m_sx + (rect.Left - m_px);
                                    showY = m_sy + (rect.Top  - m_py);
                                }
                                else
                                {
                                    showX = m_sx;
                                    showY = m_sy;
                                }
                            }
                            MoveWindow(this.Handle, showX, showY, m_w, m_h, true);
                            ShowWindow(this.Handle, 5);
                            BringWindowToTop(this.Handle);
                            SetForegroundWindow(this.Handle);
                            if (rdpHost != null) SetFocus(rdpHost.Handle);
                            isVisible = true;
                        });
                    }
                    else if (line == "FOCUS")
                    {
                        this.Invoke((MethodInvoker)delegate
                        {
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
    }

    class Program
    {
        // Per-Monitor V2 DPI awareness — makes all Win32 coordinate APIs return
        // true physical pixels on whichever monitor the window lives on.
        // This is mandatory when the host app (Tauri) runs at a different DPI than
        // the system default (e.g. laptop screen at 150% + external at 100%).
        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("shcore.dll", SetLastError = true)]
        static extern int SetProcessDpiAwareness(int value);

        // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4 (Windows 10 1703+)
        static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);

        static void SetDpiAwareness()
        {
            try
            {
                // Best: per-monitor v2 (Win10 1703+)
                if (SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2))
                    return;
            }
            catch { }

            try
            {
                // Fallback: per-monitor v1 (Win8.1+), value 2 = PROCESS_PER_MONITOR_DPI_AWARE
                SetProcessDpiAwareness(2);
            }
            catch { }
        }

        [STAThread]
        static void Main(string[] args)
        {
            // Must be called before any window or DPI query — sets physical-pixel
            // coordinate mode so MoveWindow/GetWindowRect match Tauri's values.
            SetDpiAwareness();

            if (args.Length < 8)
            {
                Console.Error.WriteLine(
                    "Usage: RdpEmbed.exe <host> <port> <user> <pass> <parent_hwnd> <x> <y> <w> <h>");
                Environment.Exit(1);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string host  = args[0];
            int    port  = int.Parse(args[1]);
            string user  = args[2];
            string pass  = args[3];
            long   phwnd = long.Parse(args[4]);
            int    px    = int.Parse(args[5]);
            int    py    = int.Parse(args[6]);
            int    pw    = int.Parse(args[7]);
            int    ph    = args.Length > 8 ? int.Parse(args[8]) : 600;

            try
            {
                var form = new RdpForm(host, port, user, pass, phwnd, px, py, pw, ph);
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
