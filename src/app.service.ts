import { Injectable } from '@nestjs/common';
import { createError } from 'evlog';
import { useLogger } from 'evlog/nestjs';

type UserProfile = {
  id: string;
  name: string;
  plan: 'free' | 'pro';
};

type OrderSummary = {
  id: string;
  total: number;
};

@Injectable()
export class AppService {
  getHello(): string {
    const log = useLogger();
    log.set({ app: { feature: 'home' } });
    return 'Hello World!';
  }

  async getUserProfile(id: string): Promise<UserProfile> {
    const log = useLogger();
    log.set({ user: { id }, source: { layer: 'service' } });

    const user = await this.fetchUser(id);

    log.set({ user: { name: user.name, plan: user.plan } });
    return user;
  }

  async getUserOrders(id: string): Promise<OrderSummary[]> {
    const log = useLogger();
    log.set({ orders: { forUserId: id }, source: { layer: 'service' } });

    const orders = await this.fetchOrders(id);

    const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
    log.set({
      orders: {
        count: orders.length,
        totalRevenue,
      },
    });

    return orders;
  }

  failUserSync(id: string): never {
    const log = useLogger();
    log.set({ sync: { userId: id, step: 'upsert-user' } });

    throw createError({
      message: 'User sync failed',
      status: 500,
      why: 'Upstream profile API returned malformed payload',
      fix: 'Retry and validate the upstream schema before mapping',
      link: 'https://docs.example.com/sync/users',
    });
  }

  checkout(): never {
    const log = useLogger();
    log.set({ checkout: { step: 'charge' } });

    throw createError({
      message: 'Payment failed',
      status: 402,
      why: 'Card declined by issuer',
      fix: 'Try a different payment method',
      link: 'https://docs.example.com/payments/declined',
    });
  }

  private async fetchUser(id: string): Promise<UserProfile> {
    await this.delay(20);

    return {
      id,
      name: id === 'usr_pro' ? 'Alice' : 'Bob',
      plan: id === 'usr_pro' ? 'pro' : 'free',
    };
  }

  private async fetchOrders(id: string): Promise<OrderSummary[]> {
    await this.delay(20);

    return [
      { id: `${id}_ord_1`, total: 1999 },
      { id: `${id}_ord_2`, total: 4299 },
    ];
  }

  private async delay(ms: number) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
