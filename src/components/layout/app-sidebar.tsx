"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ChevronRight,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Settings,
  Warehouse,
} from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

const productItems = [
  { title: "Products", href: "/products" },
  { title: "Brands", href: "/brands" },
  { title: "Suppliers", href: "/suppliers" },
  { title: "Origins", href: "/origins" },
]

const inventoryItems = [
  { title: "Stock overview", href: "/inventory" },
  { title: "Locations", href: "/locations" },
]

// "System Constants" is the page /settings has always been; it moved under a
// group rather than to a new URL when Postcodes joined it.
const settingsItems = [
  { title: "System Constants", href: "/settings" },
  // One entry for the whole shipping reference domain rather than six. Its own
  // page is a hub linking to them, which keeps this list readable and gives the
  // six screens somewhere to explain how they fit together.
  { title: "Shipping", href: "/settings/shipping" },
  { title: "Postcodes", href: "/settings/postcodes" },
  { title: "Countries", href: "/settings/countries" },
]

// Orders, Customers and Export Labels are one workflow — a customer places an
// order, it gets picked, it ships — so they share a group rather than sitting as
// three flat entries. Listed in the order the work happens in.
const salesItems = [
  { title: "Orders", href: "/orders" },
  { title: "Customers", href: "/customers" },
  // Between the two on purpose: allocation is what turns a Pending order into a
  // Processing one, which is the queue Export Labels reads.
  { title: "Allocation", href: "/fulfillment/allocation" },
  { title: "Export Labels", href: "/fulfillment/export-labels" },
]

export function AppSidebar() {
  const pathname = usePathname()
  const isProductsActive = productItems.some((item) =>
    pathname.startsWith(item.href)
  )
  const isInventoryActive = inventoryItems.some((item) =>
    pathname.startsWith(item.href)
  )
  const isSalesActive = salesItems.some((item) =>
    pathname.startsWith(item.href)
  )
  const isSettingsActive = pathname.startsWith("/settings")

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-8 items-center gap-2 px-2 group-data-[collapsible=icon]:justify-center">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            G2
          </span>
          <span className="truncate text-sm font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            Go2Office
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/"}
                  tooltip="Dashboard"
                >
                  <Link href="/">
                    <LayoutDashboard />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <Collapsible
                asChild
                defaultOpen={isProductsActive}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip="Catalog"
                      isActive={isProductsActive}
                    >
                      <Package />
                      <span>Catalog</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {productItems.map((item) => {
                        const isActive =
                          item.href === "/products"
                            ? pathname === "/products"
                            : pathname.startsWith(item.href)

                        return (
                          <SidebarMenuSubItem key={item.href}>
                            <SidebarMenuSubButton asChild isActive={isActive}>
                              <Link href={item.href}>
                                <span>{item.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              <Collapsible
                asChild
                defaultOpen={isInventoryActive}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip="Inventory"
                      isActive={isInventoryActive}
                    >
                      <Warehouse />
                      <span>Inventory</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {inventoryItems.map((item) => (
                        <SidebarMenuSubItem key={item.href}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={pathname.startsWith(item.href)}
                          >
                            <Link href={item.href}>
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              <Collapsible
                asChild
                defaultOpen={isSalesActive}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Sales" isActive={isSalesActive}>
                      <ShoppingCart />
                      <span>Sales</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {salesItems.map((item) => (
                        <SidebarMenuSubItem key={item.href}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={pathname.startsWith(item.href)}
                          >
                            <Link href={item.href}>
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              <Collapsible
                asChild
                defaultOpen={isSettingsActive}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip="Settings"
                      isActive={isSettingsActive}
                    >
                      <Settings />
                      <span>Settings</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {settingsItems.map((item) => {
                        // Exact match for the group's own root, or it stays lit
                        // while a child page is open — same reason /products
                        // above is special-cased.
                        const isActive =
                          item.href === "/settings"
                            ? pathname === "/settings"
                            : pathname.startsWith(item.href)

                        return (
                          <SidebarMenuSubItem key={item.href}>
                            <SidebarMenuSubButton asChild isActive={isActive}>
                              <Link href={item.href}>
                                <span>{item.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
