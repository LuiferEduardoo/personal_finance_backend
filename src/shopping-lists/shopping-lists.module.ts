import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShoppingListItem } from './entities/shopping-list-item.entity';
import { ShoppingList } from './entities/shopping-list.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ShoppingList, ShoppingListItem])],
  exports: [TypeOrmModule],
})
export class ShoppingListsModule {}
