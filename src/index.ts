export { Room } from './rooms/room';
import router from "./controller/routes";
import type { Env } from "./env";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    return router.fetch(request, env, ctx)
  }
} satisfies ExportedHandler<Env>;
