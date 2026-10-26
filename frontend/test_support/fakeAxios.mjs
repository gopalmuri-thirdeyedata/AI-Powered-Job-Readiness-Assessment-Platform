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

// axios.defaults / axios.interceptors as the auth client uses them: tests read the registered handlers from globalThis.
const defaults = (globalThis.__axiosDefaults = globalThis.__axiosDefaults || {});
const interceptors = (globalThis.__axiosInterceptors = globalThis.__axiosInterceptors || { request: [], response: [] });

export default {
    defaults,
    interceptors: {
        request: { use: (onFulfilled) => { globalThis.__axiosInterceptors.request.push(onFulfilled); } },
        response: { use: (onFulfilled, onRejected) => { globalThis.__axiosInterceptors.response.push(onFulfilled, onRejected); } },
    },
    get: (url, config) => respond('get', url, config),
    post: (url, body, config) => respond('post', url, body, config),
    put: (url, body, config) => respond('put', url, body, config),
    patch: (url, body, config) => respond('patch', url, body, config),
};
