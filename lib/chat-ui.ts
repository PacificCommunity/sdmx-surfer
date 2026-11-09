/**
 * `experimental_throttle` for every useChat surface.
 *
 * Without it every stream chunk is its own synchronous React update. Models
 * that stream tool input in tiny pieces (GPT-6.1 Terra: ~700 chunks for one
 * update_dashboard call) deliver them in bursts, and a burst of nested updates
 * passes React's limit (error #185, "Maximum update depth exceeded"). useChat
 * then aborts the stream mid tool call. Batching updates every 50 ms keeps
 * text streaming smooth and the update count bounded.
 */
export const CHAT_UI_THROTTLE_MS = 50;
