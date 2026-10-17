import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

interface MinimalRequest {
  originalUrl?: string;
  url: string;
}
interface MinimalResponse {
  headersSent: boolean;
  status(code: number): MinimalResponse;
  json(body: unknown): void;
}

/**
 * Every error as api-contract Rule 1's flat shape: `{ statusCode, error, message, code, path }`. `error` is the
 * standard reason phrase; `code` is null unless the exception carries one (a typed business-rule violation). An
 * unexpected error is logged and answered as a generic 500 — its details never reach the client.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<MinimalRequest>();
    const response = http.getResponse<MinimalResponse>();
    // A streamed response (CSV export) that fails midway has already sent its headers — nothing to rewrite.
    if (response.headersSent) return;

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'An unexpected error occurred.';
    let code: string | null = null;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; code?: unknown };
        if (b.message !== undefined) message = b.message;
        if (typeof b.code === 'string') code = b.code;
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    }

    response.status(statusCode).json({
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message,
      code,
      path: (request.originalUrl ?? request.url).split('?')[0],
    });
  }
}
