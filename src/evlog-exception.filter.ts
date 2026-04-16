import { Catch } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { parseError } from 'evlog';
import { useLogger } from 'evlog/nestjs';

@Catch()
export class EvlogExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const error =
      exception instanceof Error ? exception : new Error(String(exception));

    try {
      useLogger().error(error);
    } catch {
      // Logger is unavailable for non-http or out-of-scope contexts.
    }

    const parsed = parseError(error);

    response.status(parsed.status).json({
      message: parsed.message,
      why: parsed.why,
      fix: parsed.fix,
      link: parsed.link,
    });
  }
}
