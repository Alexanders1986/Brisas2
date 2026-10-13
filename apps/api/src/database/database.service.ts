import { schema } from '@brisas/database';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppConfig } from '../config/app-config';

type Db = NodePgDatabase<typeof schema>;
/** Transacción con el contexto de seguridad ya declarado. Es la única forma de consultar datos. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

type Scope = 'tenant' | 'platform' | 'system';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger('BaseDeDatos');
  private readonly pool: Pool;
  private readonly db: Db;

  constructor(config: AppConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
    this.pool.on('error', (error) => this.logger.error({ message: error.message }));
    this.db = drizzle(this.pool, { schema });
  }

  /**
   * Operación dentro de un conjunto. Row Level Security limita cada consulta a las
   * filas de `tenantId`, de modo que un filtro olvidado no expone datos de otro conjunto.
   */
  tenant<T>(context: { tenantId: string; userId: string }, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run('tenant', context.tenantId, context.userId, work);
  }

  /** Operación del SuperAdmin de plataforma: ve todos los conjuntos. */
  platform<T>(userId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run('platform', null, userId, work);
  }

  /** Autenticación y trabajos en segundo plano: código de confianza sin usuario o sin conjunto. */
  system<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run('system', null, null, work);
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private run<T>(scope: Scope, tenantId: string | null, userId: string | null, work: (tx: Tx) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      // set_config(..., true) limita el valor a esta transacción: no se filtra a otras
      // peticiones que reutilicen la misma conexión del pool.
      await tx.execute(sql`
        SELECT set_config('app.scope', ${scope}, true),
               set_config('app.tenant_id', ${tenantId ?? ''}, true),
               set_config('app.user_id', ${userId ?? ''}, true)
      `);
      return work(tx);
    });
  }
}
