import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ExpenseDraft } from '../dto/expense-draft.dto';

// De dónde salió el análisis: una imagen de factura o un texto.
export enum InvoiceSource {
  IMAGE = 'image',
  TEXT = 'text',
}

// Registro de cada factura analizada con IA: guarda la entrada (imagen o
// texto) y el borrador de gasto que devolvió el modelo.
@Entity('invoice_analyses')
@Index('idx_invoice_analyses_user_date', ['userId', 'createdAt'])
export class InvoiceAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: InvoiceSource,
    enumName: 'invoice_source',
  })
  source: InvoiceSource;

  // Texto analizado (solo cuando source = TEXT).
  @Column({ name: 'input_text', type: 'text', nullable: true })
  inputText: string | null;

  // Bytes de la imagen analizada (solo cuando source = IMAGE).
  @Column({ name: 'image_data', type: 'bytea', nullable: true })
  imageData: Buffer | null;

  @Column({ name: 'image_mime_type', type: 'text', nullable: true })
  imageMimeType: string | null;

  // Modelo de IA usado (p. ej. gpt-4o).
  @Column({ type: 'text' })
  model: string;

  // Borrador de gasto que devolvió el modelo.
  @Column({ type: 'jsonb' })
  result: ExpenseDraft;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
