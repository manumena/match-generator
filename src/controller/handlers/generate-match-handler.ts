import type { Handler } from "hono";
import { generateMatch, type MatchOptions } from "../../logic/generate-match";
import type { Env } from "../../env";

const generateMatchHandler: Handler<{ Bindings: Env }> = async (context) => {
  const options: MatchOptions = {};
  // Preserve the old router's last-value-wins rule for duplicate parameters.
  const query = Object.fromEntries(new URL(context.req.url).searchParams);

  if ('amount' in query) {
    options.amount = parseInt(query.amount);
  }
  if ('repeatAnimes' in query) {
    options.repeatAnimes = query.repeatAnimes === 'true';
  }
  if ('includeOpenings' in query) {
    options.includeOpenings = query.includeOpenings === 'true';
  }
  if ('includeEndings' in query) {
    options.includeEndings = query.includeEndings === 'true';
  }
  if ('includeSoundtracks' in query) {
    options.includeSoundtracks = query.includeSoundtracks === 'true';
  }

  const response = await generateMatch(context.env, options);
  return context.body(JSON.stringify({ match: response }), 200, { 'Content-Type': 'application/json' });
}

export default generateMatchHandler
