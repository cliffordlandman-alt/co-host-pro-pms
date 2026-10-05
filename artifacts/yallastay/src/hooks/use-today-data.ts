import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-fetch';
import { useAuth } from '@/contexts/auth-context';
import type { PMSRecord } from '@/lib/today-model';
export function usePMSData(path:string,enabled=true,poll=false){
 return useQuery<PMSRecord[]>({queryKey:['experience',path],enabled,staleTime:30000,refetchInterval:poll?30000:false,queryFn:async()=>{const r=await apiFetch(`/api/${path}`);if(!r.ok)throw new Error(`Could not load ${path}`);const data=await r.json();return Array.isArray(data)?data:[];}});
}
export function useTodayData(enabled=true){
 const {user}=useAuth();const operator=!!user && !['cleaner','maintenance','owner'].includes(user.role);
 const financial=!!user && ['admin','super_admin','manager','accountant'].includes(user.role);
 const properties=usePMSData('properties',enabled&&operator,true),bookings=usePMSData('reservations',enabled&&operator,true);
 const cleaning=usePMSData('cleaning',enabled&&(operator || user?.role==='cleaner') && user?.role!=='accountant' && user?.role!=='reservations',true);
 const maintenance=usePMSData('maintenance',enabled&&(operator || user?.role==='maintenance') && user?.role!=='accountant' && user?.role!=='reservations',true);
 const statements=usePMSData('accounting/statements',enabled&&financial,true);
 return {properties,bookings,cleaning,maintenance,statements,financial,operator};
}
