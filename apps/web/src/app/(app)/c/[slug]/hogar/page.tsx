'use client';

import type { MyHouseholdResponse } from '@brisas/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { House } from 'lucide-react';
import { HouseholdPanel } from '@/components/household-panel';
import { useTenant } from '@/components/tenant-context';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';

export default function MyHouseholdPage() {
  const tenant = useTenant();
  const queryClient = useQueryClient();
  const household = useQuery({
    queryKey: [tenant.tenantId, 'my-household'],
    queryFn: () => api<MyHouseholdResponse>(`${tenant.apiPath}/my/household`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [tenant.tenantId] });

  return (
    <>
      <PageHeader
        title="Mi hogar"
        description="Cuéntale a la administración quiénes viven contigo, qué vehículos tienen y cuáles son sus mascotas. Solo tú y la administración ven estos datos."
      />
      {household.isPending ? (
        <Skeleton className="h-64" />
      ) : household.data && household.data.units.length > 0 ? (
        <div className="flex flex-col gap-8">
          {household.data.units.map((unit) => (
            <section key={unit.propertyId}>
              <h2 className="mb-3 text-xl font-semibold">{unit.propertyLabel}</h2>
              <HouseholdPanel household={unit} onChanged={refresh} />
            </section>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={House}
            title="Aún no tienes una unidad vinculada"
            description="Cuando la administración te vincule a tu apartamento o casa, aquí podrás registrar a tu familia y tus vehículos."
          />
        </Card>
      )}
    </>
  );
}
