import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expense } from '../transactions/entities/expense.entity';
import { ArticleInflationResolver } from './article-inflation.resolver';
import { ArticleInflationService } from './article-inflation.service';
import { ArticlesResolver } from './articles.resolver';
import { ArticlesService } from './articles.service';
import { Article } from './entities/article.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Article, Expense])],
  providers: [
    ArticlesService,
    ArticlesResolver,
    ArticleInflationService,
    ArticleInflationResolver,
  ],
  exports: [TypeOrmModule, ArticlesService],
})
export class ArticlesModule {}
