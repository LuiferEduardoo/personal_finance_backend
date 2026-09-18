import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { ApiScope } from '../common/enums/api-scope.enum';
import { ArticleInflationService } from './article-inflation.service';
import { ArticleInflationFilterInput } from './dto/article-inflation-filter.input';
import { ArticleInflationReport } from './dto/article-inflation.type';

@Resolver(() => ArticleInflationReport)
@UseGuards(GqlAuthGuard)
export class ArticleInflationResolver {
  constructor(
    private readonly articleInflationService: ArticleInflationService,
  ) {}

  @Query(() => ArticleInflationReport, {
    description:
      'Inflación real (índice de precios) por artículo y categoría. NO es expenseInflation (variación de gasto).',
  })
  @Scopes(ApiScope.INFLATION_READ)
  articleInflation(
    @CurrentUser() user: JwtPayload,
    @Args('filter', { nullable: true }) filter?: ArticleInflationFilterInput,
  ): Promise<ArticleInflationReport> {
    return this.articleInflationService.articleInflation(user.sub, filter);
  }
}
