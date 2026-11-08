import { expect, type ConsoleMessage, type Page } from '@playwright/test';

export type BrowserFailure = {
    route: string;
    channel: 'console.error' | 'pageerror';
    message: string;
    sourceUrl?: string;
    lineNumber?: number;
    columnNumber?: number;
    stackSummary?: string;
};

export type BrowserErrorCollector = {
    readonly failures: BrowserFailure[];
    dispose(): void;
};

type BrowserErrorCollectorOptions = { consoleErrors?: boolean };

function isExpectedHioSyntaxWarning(text: string): boolean {
    // The pinned HIO 0.7.20 runtime emits these two Python 3.14 warnings on stdout,
    // which PyScript forwards as console.error. Keep the match to these exact lines.
    const warning = text.match(
        /^\/lib\/python3\.14\/site-packages\/hio\/help\/doming\.py:(364|634): SyntaxWarning: "([^"]+)" is an invalid escape sequence\./,
    );
    if (warning?.[2] === '\\*') {
        return true;
    }

    return text === '  _update(\\*pa, \\*\\*kwa): update attributes using dict like update syntax';
}

function isExpectedBrowserNoise(message: ConsoleMessage): boolean {
    const text = message.text();
    if (isExpectedHioSyntaxWarning(text)) {
        return true;
    }

    // Chrome requests this optional icon automatically. Ignore only its observed 404.
    const locationUrl = message.location().url;
    if (text !== 'Failed to load resource: the server responded with a status of 404 (File not found)' || locationUrl === '') {
        return false;
    }
    try {
        return new URL(locationUrl).pathname === '/favicon.ico';
    } catch {
        return false;
    }
}

function currentRoute(page: Page): string {
    try {
        return new URL(page.url()).hash.slice(1) || new URL(page.url()).pathname;
    } catch {
        return page.url() || '(before navigation)';
    }
}

export function collectBrowserErrors(
    page: Page,
    route: () => string = () => currentRoute(page),
    options: BrowserErrorCollectorOptions = {},
): BrowserErrorCollector {
    const failures: BrowserFailure[] = [];

    const onPageError = (error: Error): void => {
        failures.push({
            route: route(),
            channel: 'pageerror',
            message: error.message,
            stackSummary: error.stack?.split('\n').slice(1, 3).map((line) => line.trim()).join(' | '),
        });
    };

    const onConsole = (message: ConsoleMessage): void => {
        if (message.type() !== 'error' || isExpectedBrowserNoise(message)) {
            return;
        }

        const location = message.location();
        failures.push({
            route: route(),
            channel: 'console.error',
            message: message.text(),
            sourceUrl: location.url || undefined,
            lineNumber: location.lineNumber + 1,
            columnNumber: location.columnNumber + 1,
        });
    };

    page.on('pageerror', onPageError);
    if (options.consoleErrors !== false) {
        page.on('console', onConsole);
    }

    return {
        failures,
        dispose(): void {
            page.off('pageerror', onPageError);
            if (options.consoleErrors !== false) {
                page.off('console', onConsole);
            }
        },
    };
}

export function collectPageErrors(page: Page, route?: () => string): BrowserErrorCollector {
    return collectBrowserErrors(page, route, { consoleErrors: false });
}

export function formatBrowserFailures(failures: BrowserFailure[]): string {
    return failures.map((failure) => {
        const location = failure.sourceUrl
            ? ` (${failure.sourceUrl}:${failure.lineNumber}:${failure.columnNumber})`
            : '';
        const stack = failure.stackSummary ? `; ${failure.stackSummary}` : '';
        return `${failure.route}:\n  ${failure.channel}: ${failure.message}${location}${stack}`;
    }).join('\n');
}

export async function expectNoBrowserErrors(
    page: Page,
    collector: BrowserErrorCollector,
    settleMilliseconds = 250,
): Promise<void> {
    if (settleMilliseconds > 0) {
        await page.waitForTimeout(settleMilliseconds);
    }
    expect(collector.failures, formatBrowserFailures(collector.failures)).toEqual([]);
}
