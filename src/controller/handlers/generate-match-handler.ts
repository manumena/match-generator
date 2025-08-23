import { RouterHandler } from "@tsndr/cloudflare-worker-router";
import { generateMatch } from "../../logic/generate-match";
import { Env } from "../../env";

const generateMatchHandler: RouterHandler<Env> = async ({ res, req, env }) => {
  const options: any = {};

  if ('amount' in req.query) {
    options.amount = parseInt(req.query.amount);
  }
  if ('repeatAnimes' in req.query) {
    options.repeatAnimes = req.query.repeatAnimes === 'true';
  }
  if ('includeOpenings' in req.query) {
    options.includeOpenings = req.query.includeOpenings === 'true';
  }
  if ('includeEndings' in req.query) {
    options.includeEndings = req.query.includeEndings === 'true';
  }
  if ('includeSoundtracks' in req.query) {
    options.includeSoundtracks = req.query.includeSoundtracks === 'true';
  }

  const response = await generateMatch(env, options)
  res.status = 200
  res.body = {
    match: response
  }
}

export default generateMatchHandler
