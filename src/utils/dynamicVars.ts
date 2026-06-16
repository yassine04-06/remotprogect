// Auto-expanded snippet variables. Unlike the {{user-prompted}} placeholders,
// these single-brace tokens are substituted automatically at inject time from
// the current date/time and the active connection's context.

export interface DynamicVarContext {
    host?: string;
    port?: number;
    username?: string;
}

/** Expands {date} {time} {datetime} {host} {host_ip} {port} {user} in `cmd`. */
export function expandDynamicVars(cmd: string, ctx: DynamicVarContext = {}): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const map: Record<string, string> = {
        date,
        time,
        datetime: `${date}_${time}`,
        host: ctx.host ?? '',
        host_ip: ctx.host ?? '',
        port: ctx.port != null ? String(ctx.port) : '',
        user: ctx.username ?? '',
    };

    // Single brace, not double (double is reserved for user-prompted vars).
    return cmd.replace(/(?<!\{)\{([a-z_]+)\}(?!\})/g, (full, key: string) =>
        key in map ? map[key] : full
    );
}
