import { Controller, Get, Param } from '@nestjs/common';
import { AppService } from './app.service';
import { useLogger } from './logger';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('users/:id')
  async getUser(@Param('id') id: string) {
    const log = useLogger();
    log.set({ source: { layer: 'controller' }, route: { name: 'get-user' } });

    const user = await this.appService.getUserProfile(id);
    return { user };
  }

  @Get('users/:id/orders')
  async getUserOrders(@Param('id') id: string) {
    const log = useLogger();
    log.set({
      source: { layer: 'controller' },
      route: { name: 'get-user-orders' },
    });

    const orders = await this.appService.getUserOrders(id);
    return { orders };
  }

  @Get('users/:id/sync-error')
  syncError(@Param('id') id: string) {
    const log = useLogger();
    log.set({ source: { layer: 'controller' }, route: { name: 'sync-error' } });

    return this.appService.failUserSync(id);
  }

  @Get('checkout')
  checkout() {
    return this.appService.checkout();
  }

  @Get('redaction-test')
  redactionTest() {
    const log = useLogger();

    log.set({
      source: { layer: 'controller' },
      route: { name: 'redaction-test' },
      user: {
        email: 'alice@example.com',
        phone: '+1 555 123 4567',
        password: 'super-secret-password',
      },
      payment: {
        card: '4111 1111 1111 1111',
      },
      headers: {
        authorization: 'Bearer abcdefghijklmnop',
      },
      auth: {
        jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature',
        refreshToken: 'refresh-token-value',
      },
    });

    return {
      message: 'Redaction test values were added to the log context.',
      check:
        'Inspect the emitted request log for masked email, phone, card, bearer token, JWT, password, authorization, and refreshToken values.',
    };
  }
}
