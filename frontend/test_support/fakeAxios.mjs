// Recording stand-in for axios used only by the node:test suites.
const calls = (globalThis.__axiosCalls = globalThis.__axiosCalls || []);

const respond = (method, url, bodyOrConfig, maybeConfig) => {
    const isBodyMethod = method !== 'get';
    const config = (isBodyMethod ? maybeConfig : bodyOrConfig) || {};
    const call = { method, url, body: isBodyMethod ? bodyOrConfig : undefined, headers: config.headers || {}, params: config.params, timeout: config.timeout };
    calls.push(call);
    // A test may install a handler to script per-URL responses or failures: (call) => data | Promise.reject({ response: { status, data } })
    if (typeof globalThis.__axiosHandler === 'function') {
        return Promise.resolve(globalThis.__axiosHandler(call)).then((data) => ({ data }));
    }
    return Promise.resolve({ data: globalThis.__axiosResponse ?? {} });
};

export default {
    get: (url, config) => respond('get', url, config),
    post: (url, body, config) => respond('post', url, body, config),
    put: (url, body, config) => respond('put', url, body, config),
};
