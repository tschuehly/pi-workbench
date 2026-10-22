// Preload for a test host process (NODE_OPTIONS=--import): fetch to chatgpt.com goes to the local mock origin in
// PILOT_CHATGPT_MOCK; every other non-loopback fetch fails, so nothing leaves the machine.
const mock = process.env.PILOT_CHATGPT_MOCK;
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.hostname === "chatgpt.com") return realFetch(new URL(url.pathname + url.search, mock), init);
	if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return Promise.reject(new Error(`network blocked by test: ${url.host}`));
	return realFetch(input, init);
};
