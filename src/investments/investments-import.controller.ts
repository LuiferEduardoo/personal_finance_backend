import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
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
import {
  ImportBatchDraft,
  ImportCommitResult,
  InvestmentTransactionDraft,
} from './dto/import-batch-draft.dto';
import { ImportService } from './import/import.service';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Tipos MIME que mandan los navegadores y los brókers para CSV y XLSX. La
// lista sola NO basta: un CSV llega muy a menudo como
// application/octet-stream, así que hay respaldo por extensión.
const ALLOWED_MIME_TYPES = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
];
const ALLOWED_EXTENSIONS = /\.(csv|tsv|txt|xlsx|xls)$/i;

interface CommitBody {
  batchId: string;
  accountId: string;
  rows?: InvestmentTransactionDraft[];
}

interface RemapBody {
  batchId: string;
  columnMapping: Record<string, string>;
  profileId?: string;
}

// REST con multer, no GraphQL Upload: misma decisión que InvoicesController.
@Controller('investments/import')
@UseGuards(JwtAuthGuard)
export class InvestmentsImportController {
  constructor(private readonly importService: ImportService) {}

  // Paso 1: subir y obtener el borrador. NO persiste operaciones.
  @Post('analyze')
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }),
  )
  analyze(
    @CurrentUserRest() user: Principal,
    @UploadedFile() file?: Express.Multer.File,
    @Query('accountId') accountId?: string,
  ): Promise<ImportBatchDraft> {
    this.assertFile(file);
    // el usuario sale SIEMPRE del token, nunca del cuerpo
    return this.importService.analyze(user.sub, file!, accountId);
  }

  // Paso 1b: re-parsear el archivo archivado con un mapeo corregido.
  @Post('remap')
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  remap(
    @CurrentUserRest() user: Principal,
    @Body() body: RemapBody,
  ): Promise<ImportBatchDraft> {
    if (!body?.batchId || !body?.columnMapping) {
      throw new BadRequestException('Faltan batchId o columnMapping');
    }
    return this.importService.remap(
      user.sub,
      body.batchId,
      body.columnMapping,
      body.profileId,
    );
  }

  // Paso 2: confirmar. Idempotente: confirmar dos veces no duplica nada.
  @Post('commit')
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  commit(
    @CurrentUserRest() user: Principal,
    @Body() body: CommitBody,
  ): Promise<ImportCommitResult> {
    if (!body?.batchId || !body?.accountId) {
      throw new BadRequestException('Faltan batchId o accountId');
    }
    return this.importService.commit(
      user.sub,
      body.batchId,
      body.accountId,
      body.rows,
    );
  }

  @Post('discard')
  @Scopes(ApiScope.INVESTMENTS_WRITE)
  discard(
    @CurrentUserRest() user: Principal,
    @Body() body: { batchId: string },
  ): Promise<boolean> {
    if (!body?.batchId) {
      throw new BadRequestException('Falta batchId');
    }
    return this.importService.discard(user.sub, body.batchId);
  }

  @Get('batches')
  @Scopes(ApiScope.INVESTMENTS_READ)
  async batches(@CurrentUserRest() user: Principal) {
    const batches = await this.importService.findBatches(user.sub);
    // nunca se devuelve fileData: son megas de binario que el cliente no pidió
    return batches.map((batch) => ({
      id: batch.id,
      source: batch.source,
      status: batch.status,
      broker: batch.broker,
      fileName: batch.fileName,
      parserProfile: batch.parserProfile,
      stats: batch.stats,
      error: batch.error,
      createdAt: batch.createdAt,
    }));
  }

  @Get('batches/:id')
  @Scopes(ApiScope.INVESTMENTS_READ)
  batch(
    @CurrentUserRest() user: Principal,
    @Param('id') id: string,
  ): Promise<InvestmentTransactionDraft[]> {
    return this.importService.batchDraft(user.sub, id);
  }

  private assertFile(file?: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('Falta el archivo (campo "file")');
    }
    const mimeOk = ALLOWED_MIME_TYPES.includes(file.mimetype);
    const extensionOk = ALLOWED_EXTENSIONS.test(file.originalname);
    if (!mimeOk && !extensionOk) {
      throw new BadRequestException(
        'Formato no soportado: sube un CSV, TSV o XLSX',
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('El archivo supera los 10 MB');
    }
  }
}
