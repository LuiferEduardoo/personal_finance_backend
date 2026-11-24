import { UseGuards } from '@nestjs/common';
import {
  Args,
  ID,
  Int,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import { NotificationsFilterInput } from './dto/notifications-filter.input';
import { Notification } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';

@Resolver(() => Notification)
@UseGuards(GqlAuthGuard)
export class NotificationsResolver {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Query(() => [Notification], {
    description: 'Notificaciones del usuario, las más recientes primero',
  })
  @Scopes(ApiScope.NOTIFICATIONS_READ)
  notifications(
    @CurrentUser() user: Principal,
    @Args('filter', { nullable: true }) filter?: NotificationsFilterInput,
  ): Promise<Notification[]> {
    return this.notificationsService.findAll(user.sub, filter);
  }

  @Query(() => Int, { description: 'Cantidad de notificaciones sin leer' })
  @Scopes(ApiScope.NOTIFICATIONS_READ)
  unreadNotificationsCount(@CurrentUser() user: Principal): Promise<number> {
    return this.notificationsService.unreadCount(user.sub);
  }

  @ResolveField(() => Boolean, {
    description: 'Si ya se leyó (readAt != null)',
  })
  @Scopes(ApiScope.NOTIFICATIONS_READ)
  read(@Parent() notification: Notification): boolean {
    return notification.readAt != null;
  }

  @Mutation(() => Notification, {
    description: 'Marca una notificación como leída (idempotente)',
  })
  @Scopes(ApiScope.NOTIFICATIONS_WRITE)
  markNotificationRead(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<Notification> {
    return this.notificationsService.markRead(user.sub, id);
  }

  @Mutation(() => Int, {
    description:
      'Marca como leídas todas las notificaciones; devuelve cuántas cambiaron',
  })
  @Scopes(ApiScope.NOTIFICATIONS_WRITE)
  markAllNotificationsRead(@CurrentUser() user: Principal): Promise<number> {
    return this.notificationsService.markAllRead(user.sub);
  }

  @Mutation(() => Boolean)
  @Scopes(ApiScope.NOTIFICATIONS_WRITE)
  removeNotification(
    @CurrentUser() user: Principal,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.notificationsService.remove(user.sub, id);
  }
}
