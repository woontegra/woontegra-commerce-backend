import { PrismaClient } from '@prisma/client';

export class B2BService {
  constructor(private prisma: PrismaClient) {}

  // Customer Groups
  async getCustomerGroups(tenantId: string) {
    return this.prisma.customerGroup.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: { customers: true }
        }
      },
      orderBy: { name: 'asc' }
    });
  }

  async createCustomerGroup(tenantId: string, name: string) {
    return this.prisma.customerGroup.create({
      data: {
        name,
        tenantId
      }
    });
  }

  async updateCustomerGroup(id: string, tenantId: string, name: string) {
    return this.prisma.customerGroup.update({
      where: { 
        id,
        tenantId 
      },
      data: { name }
    });
  }

  async deleteCustomerGroup(id: string, tenantId: string) {
    // First, unassign all customers from this group
    await this.prisma.customer.updateMany({
      where: { 
        groupId: id,
        tenantId 
      },
      data: { groupId: null }
    });

    // Then delete the group
    return this.prisma.customerGroup.delete({
      where: { 
        id,
        tenantId 
      }
    });
  }

  // Customer Group Assignment
  async assignCustomerToGroup(customerId: string, groupId: string, tenantId: string) {
    // Verify customer belongs to tenant
    const customer = await this.prisma.customer.findFirst({
      where: { 
        id: customerId,
        tenantId 
      }
    });

    if (!customer) {
      throw new Error('Customer not found or does not belong to tenant');
    }

    // Verify group belongs to tenant
    const group = await this.prisma.customerGroup.findFirst({
      where: { 
        id: groupId,
        tenantId 
      }
    });

    if (!group) {
      throw new Error('Customer group not found or does not belong to tenant');
    }

    return this.prisma.customer.update({
      where: { id: customerId },
      data: { groupId }
    });
  }

  async getCustomersByGroup(groupId: string, tenantId: string) {
    return this.prisma.customer.findMany({
      where: { 
        groupId,
        tenantId 
      },
      include: {
        group: true,
        _count: {
          select: { orders: true }
        }
      },
      orderBy: { firstName: 'asc' }
    });
  }

  // Product Group Pricing
  async updateProductGroupPricing(
    variantId: string, 
    tenantId: string, 
    wholesalePrice?: number,
    groupPrices?: Record<string, number>
  ) {
    // Verify variant belongs to tenant
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: variantId,
        product: {
          tenantId
        }
      }
    });

    if (!variant) {
      throw new Error('Product variant not found or does not belong to tenant');
    }

    // Verify all group IDs belong to tenant
    if (groupPrices) {
      const groupIds = Object.keys(groupPrices);
      const groups = await this.prisma.customerGroup.findMany({
        where: {
          id: { in: groupIds },
          tenantId
        }
      });

      if (groups.length !== groupIds.length) {
        throw new Error('One or more customer groups not found or do not belong to tenant');
      }
    }

    return this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        wholesalePrice: wholesalePrice ? wholesalePrice : undefined,
        groupPrices: groupPrices ? groupPrices : undefined
      }
    });
  }

  async getProductPricing(variantId: string, tenantId: string, customerId?: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: variantId,
        product: {
          tenantId
        }
      },
      include: {
        product: true
      }
    });

    if (!variant) {
      throw new Error('Product variant not found or does not belong to tenant');
    }

    let customerGroup = null;
    if (customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: {
          id: customerId,
          tenantId
        },
        include: {
          group: true
        }
      });

      if (customer) {
        customerGroup = customer.group;
      }
    }

    // Determine pricing
    let finalPrice = variant.price || variant.product.price;
    let pricingType = 'regular';

    // If customer has a group and variant has group pricing
    if (customerGroup && variant.groupPrices) {
      const groupPrices = variant.groupPrices as Record<string, number>;
      if (groupPrices[customerGroup.id]) {
        finalPrice = groupPrices[customerGroup.id];
        pricingType = 'group';
      }
    }
    // If wholesale price and customer is a dealer/VIP
    else if (variant.wholesalePrice && customerGroup && 
             (customerGroup.name === 'Bayi' || customerGroup.name === 'VIP')) {
      finalPrice = variant.wholesalePrice;
      pricingType = 'wholesale';
    }

    return {
      variantId,
      basePrice: variant.price || variant.product.price,
      wholesalePrice: variant.wholesalePrice,
      groupPrices: variant.groupPrices,
      finalPrice,
      pricingType,
      customerGroup: customerGroup ? {
        id: customerGroup.id,
        name: customerGroup.name
      } : null
    };
  }

  async getCustomersWithoutGroup(tenantId: string) {
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        groupId: null
      },
      orderBy: { firstName: 'asc' }
    });
  }

  async bulkAssignCustomersToGroup(customerIds: string[], groupId: string, tenantId: string) {
    // Verify group belongs to tenant
    const group = await this.prisma.customerGroup.findFirst({
      where: {
        id: groupId,
        tenantId
      }
    });

    if (!group) {
      throw new Error('Customer group not found or does not belong to tenant');
    }

    // Bulk assign customers
    return this.prisma.customer.updateMany({
      where: {
        id: { in: customerIds },
        tenantId
      },
      data: { groupId }
    });
  }

  async initializeDefaultGroups(tenantId: string) {
    const defaultGroups = ['Perakende', 'Bayi', 'VIP'];
    
    const existingGroups = await this.prisma.customerGroup.findMany({
      where: {
        tenantId,
        name: { in: defaultGroups }
      }
    });

    const existingNames = existingGroups.map(g => g.name);
    const groupsToCreate = defaultGroups.filter(name => !existingNames.includes(name));

    if (groupsToCreate.length > 0) {
      await this.prisma.customerGroup.createMany({
        data: groupsToCreate.map(name => ({
          name,
          tenantId
        }))
      });
    }

    return this.prisma.customerGroup.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' }
    });
  }
}
