import { query } from '../models/database';
import type {
    AccountSelectionEntry,
    AccountSelectionResponse,
} from '../types';

interface SelectAccountsOptions {
    userId: number;
    userRole?: string;
    agentId?: number;
    matchId?: number;
    limit?: number;
}

interface AccountRow {
    id: number;
    group_id: number;
    group_name?: string;
    username: string;
    password?: string;
    display_name?: string;
    original_username?: string;
    initialized_username?: string;
    currency?: string;
    discount?: string | number | null;
    stop_profit_limit?: string | number | null;
    is_online?: boolean;
}

interface AggregatedRow {
    account_id: number;
    total_amount?: string | number | null;
    total_profit?: string | number | null;
}

const asNumber = (value: string | number | null | undefined, defaultValue = 0): number => {
    if (value === null || value === undefined) {
        return defaultValue;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : defaultValue;
};

const buildLineKey = (original?: string | null, current?: string | null): string => {
    const base = (original || current || '').trim();
    if (!base) {
        return 'UNKNOWN';
    }
    return base.slice(0, 4).toUpperCase();
};

const getDailyBoundary = (now = new Date()): Date => {
    const boundary = new Date(now);
    boundary.setHours(12, 0, 0, 0);
    if (now < boundary) {
        boundary.setDate(boundary.getDate() - 1);
    }
    return boundary;
};

const getWeeklyBoundary = (dailyBoundary: Date): Date => {
    const boundary = new Date(dailyBoundary);
    const day = boundary.getDay(); // Sunday = 0, Monday = 1
    const distanceFromMonday = day === 0 ? 6 : day - 1;
    boundary.setDate(boundary.getDate() - distanceFromMonday);
    boundary.setHours(12, 0, 0, 0);
    return boundary;
};

const rowsToMap = (rows: AggregatedRow[], key: keyof AggregatedRow): Map<number, number> => {
    const map = new Map<number, number>();
    for (const row of rows) {
        const accountId = Number(row.account_id);
        map.set(accountId, asNumber(row[key] as any));
    }
    return map;
};

export async function selectAccounts(options: SelectAccountsOptions): Promise<AccountSelectionResponse> {
    const { userId, userRole, agentId, matchId, limit } = options;

    const dailyBoundary = getDailyBoundary();
    const weeklyBoundary = getWeeklyBoundary(dailyBoundary);

    // 根据用户角色构建查询条件
    let whereClause: string;
    let queryParams: any[];

    if (userRole === 'admin') {
        // 管理员可以查看所有账号
        whereClause = 'ca.is_enabled = true';
        queryParams = [];
    } else if (userRole === 'agent') {
        // 代理可以查看下属员工的所有账号
        whereClause = 'ca.agent_id = $1 AND ca.is_enabled = true';
        queryParams = [userId];
    } else {
        // 员工可以查看同一代理下的所有账号（共享账号池）
        whereClause = 'ca.agent_id = $1 AND ca.is_enabled = true';
        queryParams = [agentId || userId];
    }

    const accountsResult = await query(
        `SELECT ca.*, g.name AS group_name
           FROM crown_accounts ca
           LEFT JOIN groups g ON g.id = ca.group_id
          WHERE ${whereClause}
          ORDER BY ca.created_at ASC`,
        queryParams,
    );

    const accountRows: AccountRow[] = accountsResult.rows;
    const accountIds = accountRows.map((row) => Number(row.id));

    if (accountIds.length === 0) {
        return {
            generated_at: new Date().toISOString(),
            daily_boundary: dailyBoundary.toISOString(),
            weekly_boundary: weeklyBoundary.toISOString(),
            match_id: matchId,
            total_accounts: 0,
            eligible_accounts: [],
            excluded_accounts: [],
        };
    }

    const [dailyEffectiveResult, dailyProfitResult, weeklyProfitResult] = await Promise.all([
        query(
            `SELECT account_id, COALESCE(SUM(bet_amount), 0) AS total_amount
               FROM bets
              WHERE user_id = $1
                AND account_id = ANY($2::int[])
                AND created_at >= $3
                AND (status IS NULL OR status <> 'cancelled')
              GROUP BY account_id`,
            [userId, accountIds, dailyBoundary],
        ),
        query(
            `SELECT account_id, COALESCE(SUM(profit_loss), 0) AS total_profit
               FROM bets
              WHERE user_id = $1
                AND account_id = ANY($2::int[])
                AND status = 'settled'
                AND settled_at IS NOT NULL
                AND settled_at >= $3
              GROUP BY account_id`,
            [userId, accountIds, dailyBoundary],
        ),
        query(
            `SELECT account_id, COALESCE(SUM(profit_loss), 0) AS total_profit
               FROM bets
              WHERE user_id = $1
                AND account_id = ANY($2::int[])
                AND status = 'settled'
                AND settled_at IS NOT NULL
                AND settled_at >= $3
              GROUP BY account_id`,
            [userId, accountIds, weeklyBoundary],
        ),
    ]);

    const dailyEffectiveMap = rowsToMap(dailyEffectiveResult.rows as AggregatedRow[], 'total_amount');
    const dailyProfitMap = rowsToMap(dailyProfitResult.rows as AggregatedRow[], 'total_profit');
    const weeklyProfitMap = rowsToMap(weeklyProfitResult.rows as AggregatedRow[], 'total_profit');

    const lineUsage = new Map<string, string[]>();

    if (matchId) {
        const matchUsageResult = await query(
            `SELECT b.account_id, b.bet_type, ca.original_username, ca.username
               FROM bets b
               JOIN crown_accounts ca ON ca.id = b.account_id
              WHERE b.user_id = $1
                AND b.match_id = $2
                AND (b.status IS NULL OR b.status <> 'cancelled')`,
            [userId, matchId],
        );

        for (const row of matchUsageResult.rows) {
            const lineKey = buildLineKey(row.original_username, row.username);
            if (!lineUsage.has(lineKey)) {
                lineUsage.set(lineKey, []);
            }
            const list = lineUsage.get(lineKey)!;
            if (row.bet_type) {
                list.push(String(row.bet_type));
            }
        }
    }

    const eligibleAccounts: AccountSelectionEntry[] = [];
    const excludedAccounts: AccountSelectionEntry[] = [];

    for (const account of accountRows) {
        const accountId = Number(account.id);
        const lineKey = buildLineKey(account.original_username, account.username);
        const dailyEffective = dailyEffectiveMap.get(accountId) ?? 0;
        const dailyProfit = dailyProfitMap.get(accountId) ?? 0;
        const weeklyProfit = weeklyProfitMap.get(accountId) ?? 0;
        const stopProfitLimit = asNumber(account.stop_profit_limit, 0);
        const discount = asNumber(account.discount, 0);
        const isOnline = Boolean(account.is_online);

        const stopProfitReached = stopProfitLimit > 0 && dailyProfit >= stopProfitLimit;
        const lineConflicted = Boolean(matchId && lineUsage.has(lineKey));

        const lossBucket = dailyProfit < 0 ? 0 : weeklyProfit < 0 ? 1 : 2;

        const entry: AccountSelectionEntry = {
            account: {
                id: accountId,
                group_id: Number(account.group_id),
                group_name: account.group_name || undefined,
                username: account.username,
                display_name: account.display_name || undefined,
                original_username: account.original_username || undefined,
                initialized_username: account.initialized_username || undefined,
                currency: account.currency || undefined,
                discount,
                stop_profit_limit: stopProfitLimit,
                line_key: lineKey,
                is_online: isOnline,
            },
            stats: {
                daily_effective_amount: dailyEffective,
                daily_profit: dailyProfit,
                weekly_profit: weeklyProfit,
                loss_bucket: lossBucket,
            },
            flags: {
                stop_profit_reached: stopProfitReached,
                line_conflicted: lineConflicted,
                offline: !isOnline,
            },
        };

        if (!isOnline || stopProfitReached || lineConflicted) {
            excludedAccounts.push(entry);
            continue;
        }

        eligibleAccounts.push(entry);
    }

    eligibleAccounts.sort((a, b) => {
        if (a.stats.daily_effective_amount !== b.stats.daily_effective_amount) {
            return a.stats.daily_effective_amount - b.stats.daily_effective_amount;
        }
        if (a.stats.loss_bucket !== b.stats.loss_bucket) {
            return a.stats.loss_bucket - b.stats.loss_bucket;
        }
        return a.account.id - b.account.id;
    });

    const limitedEligible = typeof limit === 'number' && limit > 0
        ? eligibleAccounts.slice(0, limit)
        : eligibleAccounts;

    return {
        generated_at: new Date().toISOString(),
        daily_boundary: dailyBoundary.toISOString(),
        weekly_boundary: weeklyBoundary.toISOString(),
        match_id: matchId,
        total_accounts: accountIds.length,
        eligible_accounts: limitedEligible,
        excluded_accounts: excludedAccounts,
    };
}