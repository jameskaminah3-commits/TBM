import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Edit, Trash2, Plus } from "lucide-react";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Stay, Car as CarType, Cook as CookType, Errand as ErrandType } from "@shared/schema";

type ServiceCategory = "stays" | "cars" | "cooks" | "errands";

export default function AdminListings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ServiceCategory>("stays");

  // Fetch data for each service type
  const { data: stays = [], isLoading: isLoadingStays } = useQuery<Stay[]>({
    queryKey: ["/api/admin/stays"],
  });

  const { data: cars = [], isLoading: isLoadingCars } = useQuery<CarType[]>({
    queryKey: ["/api/admin/cars"],
  });

  const { data: cooks = [], isLoading: isLoadingCooks } = useQuery<CookType[]>({
    queryKey: ["/api/admin/cooks"],
  });

  const { data: errands = [], isLoading: isLoadingErrands } = useQuery<ErrandType[]>({
    queryKey: ["/api/admin/errands"],
  });

  const deleteStayMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/stays/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stays"] });
      toast({ title: "Success", description: "Stay deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete stay", variant: "destructive" });
    },
  });

  const deleteCarMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/cars/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cars"] });
      toast({ title: "Success", description: "Car deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete car", variant: "destructive" });
    },
  });

  const deleteCookMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/cooks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cooks"] });
      toast({ title: "Success", description: "Cook deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete cook", variant: "destructive" });
    },
  });

  const deleteErrandMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/errands/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/errands"] });
      toast({ title: "Success", description: "Errand deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete errand", variant: "destructive" });
    },
  });

  const handleDelete = async (id: string, category: ServiceCategory) => {
    switch (category) {
      case "stays":
        await deleteStayMutation.mutateAsync(id);
        break;
      case "cars":
        await deleteCarMutation.mutateAsync(id);
        break;
      case "cooks":
        await deleteCookMutation.mutateAsync(id);
        break;
      case "errands":
        await deleteErrandMutation.mutateAsync(id);
        break;
    }
  };

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-semibold mb-2">Service Listings</h1>
          <p className="text-muted-foreground">
            Manage all service listings across stays, cars, cooks, and errands
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ServiceCategory)}>
          <TabsList className="mb-6">
            <TabsTrigger value="stays" data-testid="tab-stays">Stays ({stays.length})</TabsTrigger>
            <TabsTrigger value="cars" data-testid="tab-cars">Cars ({cars.length})</TabsTrigger>
            <TabsTrigger value="cooks" data-testid="tab-cooks">Cooks ({cooks.length})</TabsTrigger>
            <TabsTrigger value="errands" data-testid="tab-errands">Errands ({errands.length})</TabsTrigger>
          </TabsList>

          {/* Stays Tab */}
          <TabsContent value="stays">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle>Accommodation Stays</CardTitle>
                <Button
                  onClick={() => setLocation("/admin/stays/new")}
                  data-testid="button-add-stay"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Stay
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingStays ? (
                  <div className="text-center py-8 text-muted-foreground">Loading stays...</div>
                ) : stays.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground mb-4">No stays yet. Create your first stay to get started.</p>
                    <Button onClick={() => setLocation("/admin/stays/new")} data-testid="button-add-first-stay">
                      <Plus className="mr-2 h-4 w-4" />
                      Add First Stay
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Price/Night</TableHead>
                          <TableHead>Max Occupancy</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stays.map((stay) => (
                          <TableRow key={stay.id} data-testid={`row-stay-${stay.id}`}>
                            <TableCell className="font-medium">{stay.title}</TableCell>
                            <TableCell>{stay.location}</TableCell>
                            <TableCell>${stay.price}</TableCell>
                            <TableCell>{stay.maxOccupancy} guests</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setLocation(`/admin/stays/${stay.id}/edit`)}
                                  data-testid={`button-edit-stay-${stay.id}`}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      data-testid={`button-delete-stay-${stay.id}`}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Stay</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to delete "{stay.title}"? This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel data-testid="button-cancel-delete-stay">Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => handleDelete(stay.id, "stays")}
                                        className="bg-destructive hover:bg-destructive/90"
                                        data-testid={`button-confirm-delete-stay-${stay.id}`}
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Cars Tab */}
          <TabsContent value="cars">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle>Car Rentals</CardTitle>
                <Button
                  onClick={() => setLocation("/admin/cars/new")}
                  data-testid="button-add-car"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Car
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingCars ? (
                  <div className="text-center py-8 text-muted-foreground">Loading cars...</div>
                ) : cars.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground mb-4">No cars yet. Create your first car to get started.</p>
                    <Button onClick={() => setLocation("/admin/cars/new")} data-testid="button-add-first-car">
                      <Plus className="mr-2 h-4 w-4" />
                      Add First Car
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Model</TableHead>
                          <TableHead>Price/Day</TableHead>
                          <TableHead>With Driver</TableHead>
                          <TableHead>Seats</TableHead>
                          <TableHead>Transmission</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cars.map((car) => (
                          <TableRow key={car.id} data-testid={`row-car-${car.id}`}>
                            <TableCell className="font-medium">{car.model}</TableCell>
                            <TableCell>${car.pricePerDay}</TableCell>
                            <TableCell>{car.priceWithDriver ? `$${car.priceWithDriver}` : "N/A"}</TableCell>
                            <TableCell>{car.seats}</TableCell>
                            <TableCell className="capitalize">{car.transmission}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setLocation(`/admin/cars/${car.id}/edit`)}
                                  data-testid={`button-edit-car-${car.id}`}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      data-testid={`button-delete-car-${car.id}`}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Car</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to delete "{car.model}"? This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel data-testid="button-cancel-delete-car">Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => handleDelete(car.id, "cars")}
                                        className="bg-destructive hover:bg-destructive/90"
                                        data-testid={`button-confirm-delete-car-${car.id}`}
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Cooks Tab */}
          <TabsContent value="cooks">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle>Personal Chefs</CardTitle>
                <Button
                  onClick={() => setLocation("/admin/cooks/new")}
                  data-testid="button-add-cook"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Chef
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingCooks ? (
                  <div className="text-center py-8 text-muted-foreground">Loading chefs...</div>
                ) : cooks.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground mb-4">No chefs yet. Create your first chef to get started.</p>
                    <Button onClick={() => setLocation("/admin/cooks/new")} data-testid="button-add-first-cook">
                      <Plus className="mr-2 h-4 w-4" />
                      Add First Chef
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Chef Name</TableHead>
                          <TableHead>Speciality</TableHead>
                          <TableHead>Price/Session</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cooks.map((cook) => (
                          <TableRow key={cook.id} data-testid={`row-cook-${cook.id}`}>
                            <TableCell className="font-medium">{cook.title}</TableCell>
                            <TableCell>{cook.speciality}</TableCell>
                            <TableCell>${cook.pricePerSession}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setLocation(`/admin/cooks/${cook.id}/edit`)}
                                  data-testid={`button-edit-cook-${cook.id}`}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      data-testid={`button-delete-cook-${cook.id}`}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Chef</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to delete "{cook.title}"? This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel data-testid="button-cancel-delete-cook">Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => handleDelete(cook.id, "cooks")}
                                        className="bg-destructive hover:bg-destructive/90"
                                        data-testid={`button-confirm-delete-cook-${cook.id}`}
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Errands Tab */}
          <TabsContent value="errands">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle>Errand Services</CardTitle>
                <Button
                  onClick={() => setLocation("/admin/errands/new")}
                  data-testid="button-add-errand"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Errand
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingErrands ? (
                  <div className="text-center py-8 text-muted-foreground">Loading errands...</div>
                ) : errands.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground mb-4">No errands yet. Create your first errand to get started.</p>
                    <Button onClick={() => setLocation("/admin/errands/new")} data-testid="button-add-first-errand">
                      <Plus className="mr-2 h-4 w-4" />
                      Add First Errand
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Service Name</TableHead>
                          <TableHead>Base Price</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {errands.map((errand) => (
                          <TableRow key={errand.id} data-testid={`row-errand-${errand.id}`}>
                            <TableCell className="font-medium">{errand.serviceName}</TableCell>
                            <TableCell>${errand.basePrice}</TableCell>
                            <TableCell className="max-w-xs truncate">{errand.description}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setLocation(`/admin/errands/${errand.id}/edit`)}
                                  data-testid={`button-edit-errand-${errand.id}`}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      data-testid={`button-delete-errand-${errand.id}`}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Errand</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to delete "{errand.serviceName}"? This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel data-testid="button-cancel-delete-errand">Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => handleDelete(errand.id, "errands")}
                                        className="bg-destructive hover:bg-destructive/90"
                                        data-testid={`button-confirm-delete-errand-${errand.id}`}
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
