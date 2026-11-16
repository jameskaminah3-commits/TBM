import { HotelRoomsEditor } from "@/components/hotel-rooms-editor";

/** Admin: a hotel's room types and rates, set in US dollars. */
export function AdminHotelRoomsEditor({ stayId }: { stayId: string }) {
  return <HotelRoomsEditor stayId={stayId} scope="admin" />;
}
