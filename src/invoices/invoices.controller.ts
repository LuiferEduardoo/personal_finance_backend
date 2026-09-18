import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUserRest } from '../auth/decorators/current-user-rest.decorator';
import { Scopes } from '../auth/decorators/scopes.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Principal } from '../auth/principal';
import { ApiScope } from '../common/enums/api-scope.enum';
import { CreateExpenseInput } from '../transactions/dto/create-expense.input';
import { Expense } from '../transactions/entities/expense.entity';
import { ExpensesService } from '../transactions/expenses.service';
import { ExpenseDraft } from './dto/expense-draft.dto';
import { InvoicesService } from './invoices.service';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

@Controller('invoices')
@UseGuards(JwtAuthGuard)
@Scopes(ApiScope.INVOICES_WRITE)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly expensesService: ExpensesService,
  ) {}

  // Analiza la imagen de una factura y devuelve un borrador de gasto.
  @Post('analyze-image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  analyzeImage(
    @CurrentUserRest() user: Principal,
    @UploadedFile() image?: Express.Multer.File,
  ): Promise<ExpenseDraft> {
    if (!image) {
      throw new BadRequestException(
        'Falta el archivo de imagen (campo "image")',
      );
    }
    if (!ALLOWED_MIME_TYPES.includes(image.mimetype)) {
      throw new BadRequestException(
        'Formato de imagen no soportado (usa JPEG, PNG o WEBP)',
      );
    }
    return this.invoicesService.analyzeImage(
      user.sub,
      image.buffer,
      image.mimetype,
    );
  }

  // Analiza el texto de una factura y devuelve un borrador de gasto.
  @Post('analyze-text')
  analyzeText(
    @CurrentUserRest() user: Principal,
    @Body('text') text?: unknown,
  ): Promise<ExpenseDraft> {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new BadRequestException(
        'El campo "text" es obligatorio y no puede estar vacío',
      );
    }
    return this.invoicesService.analyzeText(user.sub, text);
  }

  // Confirma y crea el gasto a partir del borrador ya revisado por el usuario
  // (con accountId/categoryId asignados). El userId sale del token, no del
  // cuerpo, para que no se pueda crear a nombre de otro usuario.
  @Post('expense')
  createExpense(
    @CurrentUserRest() user: Principal,
    @Body() input: CreateExpenseInput,
  ): Promise<Expense> {
    return this.expensesService.create(user.sub, input);
  }
}
