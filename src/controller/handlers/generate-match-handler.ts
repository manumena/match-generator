import { RouterHandler } from "@tsndr/cloudflare-worker-router";
import { generateMatch } from "../../logic/generate-match";
import { Env } from "../../env";

const generateMatchHandler: RouterHandler<Env> = async ({ res, req, env }) => {
  const options = {
    amount: parseInt(req.query.amount),
    repeatAnimes: (req.query.repeatAnimes == 'true')
  }

  const response = await generateMatch(env, options)
  res.status = 200
  res.body = {
    match: response
  }
}

export default generateMatchHandler
