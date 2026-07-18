import { Query, Resolver } from '@nestjs/graphql';
import { AppService } from './app.service';

@Resolver()
export class AppResolver {
  constructor(private readonly appService: AppService) {}

  @Query(() => String, { description: 'Healthcheck de la API' })
  health(): string {
    return this.appService.getHello();
  }
}
