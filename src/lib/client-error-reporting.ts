// Diagnostic payloads deliberately exclude queries, contact data, and session tokens.
export function clientErrorReport(error: Error & { digest?: string }, pathname: string) {
  return {
    path: pathname.split('?')[0].slice(0, 200),
    name: error.name.slice(0, 80),
    message: error.message.replace(/https?:\/\/\S+/g, '[url]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]').slice(0, 500),
    digest: error.digest?.slice(0, 100),
    assetLoadFailure: /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(`${error.name} ${error.message}`),
  };
}
