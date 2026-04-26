export interface JsonErrorBody {
  ok: false;
  error: string;
  message: string;
}

export const jsonErrorBody = (
  error: string,
  message: string,
): JsonErrorBody => ({
  ok: false,
  error,
  message,
});

export const jsonError = (
  status: number,
  error: string,
  message: string,
  init: ResponseInit = {},
): Response =>
  Response.json(jsonErrorBody(error, message), {
    ...init,
    status,
  });
