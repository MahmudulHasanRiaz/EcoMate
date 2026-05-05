import { getSrCustomers } from "@/services/sr-portal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, MapPin, User } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SrCustomersPage() {
  const customers = await getSrCustomers();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Customers</h1>

      {customers.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No customers yet. Create customers when placing orders.
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((customer) => (
            <Card key={customer.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-full bg-primary/10">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{customer.name}</p>
                      <Badge variant="outline" className="text-xs">
                        {customer.type}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="space-y-1 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Phone className="h-3 w-3" />
                    <span>{customer.phone}</span>
                  </div>
                  {customer.address && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3 w-3" />
                      <span className="line-clamp-2">{customer.address}</span>
                    </div>
                  )}
                </div>

                <a
                  href={`/dashboard/sr/orders/new?customer=${customer.id}`}
                  className="block w-full"
                >
                  <button className="w-full text-center py-2 text-sm font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors">
                    Create Order
                  </button>
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
