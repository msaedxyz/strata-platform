// Typed client made from the OpenAPI schema of the Strata API.
// Regenerate with: pnpm api-client
import createClient from "openapi-fetch";
import type { paths } from "./schema";

export type { paths, components } from "./schema";

export type TokenProvider = () => string | null | Promise<string | null>;

export function createStrataClient(baseUrl: string, getToken: TokenProvider) {
  const client = createClient<paths>({ baseUrl });
  client.use({
    async onRequest({ request }) {
      const token = await getToken();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return request;
    },
  });
  return client;
}

export type StrataClient = ReturnType<typeof createStrataClient>;
