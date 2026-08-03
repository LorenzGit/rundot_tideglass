import type { Application } from "pixi.js";
import type * as THREE from "three/webgpu";

type Cleanup = () => Promise<void> | void;

export interface ManagedRendererResource {
    dispose(): Promise<void>;
}

export interface RendererLifecycleScope {
    readonly signal: AbortSignal;
    manage(cleanup: Cleanup): ManagedRendererResource;
    throwIfCancelled(): void;
    reportFailure(error: unknown): void;
}

export interface RendererLease<T> {
    readonly value: T;
    release(): Promise<void>;
}

export interface RendererLifecycleSnapshot {
    activeLabel: string | null;
    activeRuntimes: number;
    initializing: boolean;
    queuedOperations: number;
    initializationCount: number;
    maximumActiveRuntimes: number;
    maximumConcurrentInitializations: number;
    failureCount: number;
}

interface ActiveRuntime {
    token: symbol;
    label: string;
    resources: ManagedResource[];
    cancel(): void;
    removeAbortListener(): void;
}

interface DeviceLossInfoLike {
    message?: string;
    reason?: string;
}

interface WebGpuDeviceLike {
    lost: Promise<DeviceLossInfoLike>;
    onuncapturederror: ((event: unknown) => void) | null;
}

class ManagedResource implements ManagedRendererResource {
    private active = true;

    constructor(private readonly cleanup: Cleanup) {}

    async dispose(): Promise<void> {
        if (!this.active) return;
        this.active = false;
        await this.cleanup();
    }
}

function cancellationError(label: string): DOMException {
    return new DOMException(`${label} initialization was cancelled`, "AbortError");
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

class RendererLifecycleManager {
    private tail: Promise<void> = Promise.resolve();
    private active: ActiveRuntime | null = null;
    private queuedOperations = 0;
    private concurrentInitializations = 0;
    private initializationCount = 0;
    private maximumActiveRuntimes = 0;
    private maximumConcurrentInitializations = 0;
    private failureCount = 0;

    acquire<T>(
        label: string,
        signal: AbortSignal,
        initialize: (scope: RendererLifecycleScope) => Promise<T>,
    ): Promise<RendererLease<T>> {
        const token = Symbol(label);
        let cancelled = signal.aborted;
        const onAbort = () => {
            cancelled = true;
            void this.release(token);
        };
        signal.addEventListener("abort", onAbort);
        const removeAbortListener = () => signal.removeEventListener("abort", onAbort);

        return this.enqueue(async () => {
            if (this.active) await this.destroyActiveRuntime();
            if (cancelled) {
                removeAbortListener();
                throw cancellationError(label);
            }

            const resources: ManagedResource[] = [];
            const scope: RendererLifecycleScope = {
                signal,
                manage(cleanup) {
                    const resource = new ManagedResource(cleanup);
                    resources.push(resource);
                    return resource;
                },
                throwIfCancelled() {
                    if (cancelled) throw cancellationError(label);
                },
                reportFailure: (error) => {
                    if (!cancelled) this.reportFailure(label, error);
                },
            };

            this.concurrentInitializations += 1;
            this.initializationCount += 1;
            this.maximumConcurrentInitializations = Math.max(
                this.maximumConcurrentInitializations,
                this.concurrentInitializations,
            );

            try {
                const value = await initialize(scope);
                scope.throwIfCancelled();
                this.active = {
                    token,
                    label,
                    resources,
                    cancel: () => {
                        cancelled = true;
                    },
                    removeAbortListener,
                };
                this.maximumActiveRuntimes = Math.max(this.maximumActiveRuntimes, 1);
                return {
                    value,
                    release: () => this.release(token),
                };
            } catch (error) {
                removeAbortListener();
                await this.disposeResources(label, resources);
                throw error;
            } finally {
                this.concurrentInitializations -= 1;
            }
        });
    }

    snapshot(): RendererLifecycleSnapshot {
        return {
            activeLabel: this.active?.label ?? null,
            activeRuntimes: this.active ? 1 : 0,
            initializing: this.concurrentInitializations > 0,
            queuedOperations: this.queuedOperations,
            initializationCount: this.initializationCount,
            maximumActiveRuntimes: this.maximumActiveRuntimes,
            maximumConcurrentInitializations: this.maximumConcurrentInitializations,
            failureCount: this.failureCount,
        };
    }

    private release(token: symbol): Promise<void> {
        return this.enqueue(async () => {
            if (this.active?.token === token) await this.destroyActiveRuntime();
        });
    }

    private async destroyActiveRuntime(): Promise<void> {
        const runtime = this.active;
        if (!runtime) return;
        this.active = null;
        runtime.cancel();
        runtime.removeAbortListener();
        await this.disposeResources(runtime.label, runtime.resources);
    }

    private async disposeResources(label: string, resources: ManagedResource[]): Promise<void> {
        for (const resource of resources.reverse()) {
            try {
                await resource.dispose();
            } catch (error) {
                this.reportFailure(label, new Error(`Renderer cleanup failed: ${errorMessage(error)}`));
            }
        }
    }

    private reportFailure(label: string, error: unknown): void {
        this.failureCount += 1;
        const failure = error instanceof Error ? error : new Error(errorMessage(error));
        console.error(`[renderer:${label}] ${failure.message}`, failure);
        document.documentElement.dataset.rendererFailureCount = String(this.failureCount);
        window.dispatchEvent(
            new CustomEvent("rundot:renderer-error", {
                detail: { label, error: failure },
            }),
        );
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        this.queuedOperations += 1;
        const run = this.tail.then(
            async () => {
                this.queuedOperations -= 1;
                return operation();
            },
            async () => {
                this.queuedOperations -= 1;
                return operation();
            },
        );
        this.tail = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }
}

const lifecycleKey = Symbol.for("rundot.renderer-lifecycle");
const realm = globalThis as typeof globalThis & { [lifecycleKey]?: RendererLifecycleManager };
const lifecycleManager = realm[lifecycleKey] ?? new RendererLifecycleManager();
realm[lifecycleKey] = lifecycleManager;

export function acquireRendererRuntime<T>(
    label: string,
    signal: AbortSignal,
    initialize: (scope: RendererLifecycleScope) => Promise<T>,
): Promise<RendererLease<T>> {
    return lifecycleManager.acquire(label, signal, initialize);
}

export function rendererLifecycleSnapshot(): RendererLifecycleSnapshot {
    return lifecycleManager.snapshot();
}

export function ownPixiApplication(scope: RendererLifecycleScope, app: Application): ManagedRendererResource {
    return scope.manage(() => {
        try {
            app.destroy({ removeView: true }, { children: true });
        } catch {
            // Pixi initialization can fail before the renderer exists.
        }
    });
}

export function ownThreeRenderer(
    scope: RendererLifecycleScope,
    renderer: THREE.WebGPURenderer,
): ManagedRendererResource {
    return scope.manage(() => {
        renderer.dispose();
        renderer.domElement.remove();
    });
}

export function monitorPixiWebGpuDevice(scope: RendererLifecycleScope, app: Application, label: string): void {
    const renderer = app.renderer as unknown as { gpu?: { device?: WebGpuDeviceLike } };
    const device = renderer.gpu?.device;
    if (!device) return;

    void device.lost.then((info) => {
        if (scope.signal.aborted || info.reason === "destroyed") return;
        scope.reportFailure(new Error(`${label} GPU device lost (${info.reason ?? "unknown"}): ${info.message ?? ""}`));
    });

    const previousHandler = device.onuncapturederror;
    const handler = (event: unknown) => {
        previousHandler?.call(device, event);
        if (!scope.signal.aborted) scope.reportFailure(new Error(`${label} emitted an uncaptured WebGPU error`));
    };
    device.onuncapturederror = handler;
    scope.manage(() => {
        if (device.onuncapturederror === handler) device.onuncapturederror = previousHandler;
    });
}
