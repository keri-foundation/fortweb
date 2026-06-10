export interface PyWorkerHandle {
    sync: {
        handle_request(payload: string): Promise<unknown> | unknown;
    };
    addEventListener?(
        type: "message",
        listener: (event: { data?: unknown }) => void,
    ): void;
    onerror: ((event: { message?: string } | unknown) => void) | null;
    onmessageerror: (() => void) | null;
    terminate?(): void;
}

export function PyWorker(
    url: string,
    options: {
        type: string;
        configURL: string;
        config: unknown;
    },
): Promise<PyWorkerHandle>;