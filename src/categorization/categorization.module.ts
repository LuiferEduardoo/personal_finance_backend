import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { CategoriesModule } from '../categories/categories.module';
import { CategorizationQueue } from './categorization-queue';
import { CategoryClassifierService } from './category-classifier.service';
import { ExpenseItemsCategorizationService } from './expense-items-categorization.service';

// Clasificador compartido por la ingesta de correo, el análisis de facturas y
// el registro manual, más la cola en proceso que corre la clasificación en
// segundo plano. No importa TransactionsModule (solo el tipo Expense), así que
// TransactionsModule puede importarlo sin ciclo.
@Module({
  imports: [CategoriesModule, ArticlesModule],
  providers: [
    CategoryClassifierService,
    CategorizationQueue,
    ExpenseItemsCategorizationService,
  ],
  exports: [
    CategoryClassifierService,
    CategorizationQueue,
    ExpenseItemsCategorizationService,
  ],
})
export class CategorizationModule {}
