import { GraphQLFormattedError } from 'graphql';

// Apollo solo mapea 400 y 401 a un code propio; el resto cae en
// INTERNAL_SERVER_ERROR. Traducimos el status de las HttpException de Nest.
const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
};

interface OriginalError {
  statusCode?: number;
}

export const formatError = (
  error: GraphQLFormattedError,
): GraphQLFormattedError => {
  const extensions = { ...error.extensions };
  const status = (extensions.originalError as OriginalError | undefined)
    ?.statusCode;

  if (status && CODE_BY_STATUS[status]) {
    extensions.code = CODE_BY_STATUS[status];
  }
  if (process.env.NODE_ENV === 'production') {
    delete extensions.stacktrace;
    delete extensions.originalError;
  }

  return { ...error, extensions };
};
