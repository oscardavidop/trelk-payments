import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
} from 'typeorm';
import { User } from './user.entity';

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  paypalSubscriptionId: string;

  @Column({ type: 'varchar' })
  planId: string;

  @Column({
    type: 'varchar',
    default: 'APPROVAL_PENDING',
  })
  status: 'APPROVAL_PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';

  @Column({ type: 'varchar', nullable: true })
  paypalPayerId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'varchar' })
  currency: string;

  @Column({ type: 'datetime', nullable: true })
  nextBillingDate: Date;

  @Column({ type: 'datetime', nullable: true })
  cancelledAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.subscriptions)
  user: User;

  @Column({ type: 'uuid' })
  userId: string;
}
