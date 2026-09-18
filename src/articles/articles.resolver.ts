import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { ApiScope } from '../common/enums/api-scope.enum';
import { ArticlesService } from './articles.service';
import { CreateArticleInput } from './dto/create-article.input';
import { UpdateArticleInput } from './dto/update-article.input';
import { Article, ArticleType } from './entities/article.entity';

@Resolver(() => Article)
@UseGuards(GqlAuthGuard)
export class ArticlesResolver {
  constructor(private readonly articlesService: ArticlesService) {}

  @Query(() => [Article], {
    description:
      'Catálogo de artículos del usuario (productos, servicios, etc.)',
  })
  @Scopes(ApiScope.ARTICLES_READ)
  articles(
    @CurrentUser() user: JwtPayload,
    @Args('search', { nullable: true }) search?: string,
    @Args('type', { type: () => ArticleType, nullable: true })
    type?: ArticleType,
    @Args('includeInactive', { nullable: true, defaultValue: false })
    includeInactive?: boolean,
  ): Promise<Article[]> {
    return this.articlesService.findAll(
      user.sub,
      search,
      type,
      includeInactive,
    );
  }

  @Query(() => Article)
  @Scopes(ApiScope.ARTICLES_READ)
  article(
    @CurrentUser() user: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<Article> {
    return this.articlesService.findOne(id, user.sub);
  }

  @Mutation(() => Article)
  @Scopes(ApiScope.ARTICLES_WRITE)
  createArticle(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: CreateArticleInput,
  ): Promise<Article> {
    return this.articlesService.create(user.sub, input);
  }

  @Mutation(() => Article)
  @Scopes(ApiScope.ARTICLES_WRITE)
  updateArticle(
    @CurrentUser() user: JwtPayload,
    @Args('input') input: UpdateArticleInput,
  ): Promise<Article> {
    return this.articlesService.update(user.sub, input);
  }

  @Mutation(() => Boolean)
  @Scopes(ApiScope.ARTICLES_WRITE)
  removeArticle(
    @CurrentUser() user: JwtPayload,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.articlesService.remove(id, user.sub);
  }
}
