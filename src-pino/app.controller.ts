import { Controller, Get, Param } from '@nestjs/common';
import { AppService } from './app.service';
import { useLogger } from './logging-context';

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
}
