interface NativeBridgeMessageHandler {
    postMessage(payload: unknown): void;
}

interface AndroidBridgeHandler {
    postMessage(payload: string): void;
}

interface Window {
    webkit?: {
        messageHandlers?: Record<string, NativeBridgeMessageHandler | undefined>;
    };
    bridge?: AndroidBridgeHandler;
}