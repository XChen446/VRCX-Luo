class InteropApi {
    constructor() {
        return new Proxy(this, {
            get(target, prop) {
                // 真实方法(callMethod/onDbChange 等)始终可达;
                // 其余属性在 Windows(CefSharp)下返回 undefined,
                // 避免误用经 IPC 通道调 .NET 的路径。
                if (typeof prop === 'string' && prop in target) {
                    return target[prop];
                }
                if (WINDOWS) {
                    return undefined;
                }
                // If the property is not a method of InteropApi,
                // treat it as a .NET class name
                return new Proxy(
                    {},
                    {
                        get(_, methodName) {
                            // Return a method that calls the .NET method dynamically
                            return async (...args) => {
                                return await target.callMethod(
                                    prop,
                                    methodName,
                                    ...args
                                );
                            };
                        }
                    }
                );
            }
        });
    }

    async callMethod(className, methodName, ...args) {
        return window.interopApi
            .callDotNetMethod(className, methodName, args)
            .then((result) => {
                return result;
            });
    }

    /**
     * 订阅 C# 写漏斗事件(Electron 通道)。主进程启动时经
     * `SetChangeCallback` 注册回调,事件经 `webContents.send('db-change')`
     * 推送到渲染进程,preload 的 `electron.onDbChange` 透传。
     * 与 CefSharp 的 `SQLite.add_DatabaseChanged` 订阅同形——调用方拿到
     * 退订函数,onTableChange 卸载时一并解绑。
     *
     * @param {(payload: string) => void} callback - 接收 JSON 负载字符串
     * @returns {() => void} unsubscribe
     */
    onDbChange(callback) {
        if (
            !window.electron ||
            typeof window.electron.onDbChange !== 'function'
        ) {
            return () => {};
        }
        return window.electron.onDbChange((payload) => callback(payload));
    }
}

export default new InteropApi();
