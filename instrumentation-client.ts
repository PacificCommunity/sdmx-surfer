import { initBotId } from "botid/client/core";

// Vercel BotID: attaches an invisible challenge to these requests, which the
// routes then classify with checkBotId(). Every path listed here must call
// checkBotId(), and every route that calls it must be listed, or real users
// are classified as bots.
initBotId({
  protect: [
    { path: "/api/auth/signup", method: "POST" },
    { path: "/api/auth/email-proof/start", method: "POST" },
  ],
});
