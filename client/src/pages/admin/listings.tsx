import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Edit, Trash2, Plus } from "lucide-react";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Listing } from "@shared/schema";

const categoryColors = {
  stays: "bg-blue-100 text-blue-800 border-blue-300",
  cars: "bg-green-100 text-green-800 border-green-300",
  cooks: "bg-orange-100 text-orange-800 border-orange-300",
  errands: "bg-purple-100 text-purple-800 border-purple-300",
};

export default function AdminListings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: listings = [], isLoading } = useQuery<Listing[]>({
    queryKey: ["/api/admin/listings"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/listings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/listings"] });
      toast({
        title: "Success",
        description: "Listing deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete listing",
        variant: "destructive",
      });
    },
  });

  const handleDelete = async (id: string) => {
    await deleteMutation.mutateAsync(id);
  };

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-serif font-semibold mb-2">Listings</h1>
            <p className="text-muted-foreground">
              Manage all service listings across stays, cars, cooks, and errands
            </p>
          </div>
          <Button
            onClick={() => setLocation("/admin/listings/new")}
            data-testid="button-add-listing"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Listing
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Listings ({listings.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading listings...
              </div>
            ) : listings.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-4">
                  No listings yet. Create your first listing to get started.
                </p>
                <Button
                  onClick={() => setLocation("/admin/listings/new")}
                  data-testid="button-add-first-listing"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add First Listing
                </Button>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listings.map((listing) => (
                      <TableRow key={listing.id} data-testid={`row-listing-${listing.id}`}>
                        <TableCell className="font-medium">{listing.title}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={categoryColors[listing.category as keyof typeof categoryColors]}
                            data-testid={`badge-category-${listing.category}`}
                          >
                            {listing.category}
                          </Badge>
                        </TableCell>
                        <TableCell>${listing.price}</TableCell>
                        <TableCell>{listing.location}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setLocation(`/admin/listings/${listing.id}/edit`)}
                              data-testid={`button-edit-${listing.id}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  data-testid={`button-delete-${listing.id}`}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Listing</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete "{listing.title}"? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(listing.id)}
                                    className="bg-destructive hover:bg-destructive/90"
                                    data-testid={`button-confirm-delete-${listing.id}`}
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
      </div>
    </AdminLayout>
  );
}
