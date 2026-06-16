export async function onRequest(context) {
  const response = await context.next();
  const r = new Response(response.body, response);
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('Cache-Control', 'no-store');
  return r;
}
