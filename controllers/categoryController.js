/**
 * Product categories: page + JSON API.
 */
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const { pick } = require('../utils/requestHelpers');

const cleanInput = (body) => {
  const fields = pick(body, ['name', 'description']);
  for (const key of Object.keys(fields)) {
    fields[key] = typeof fields[key] === 'string' ? fields[key].trim() : fields[key];
  }
  return fields;
};

const findCategoryOr404 = async (id) => {
  const category = mongoose.isValidObjectId(id) ? await Category.findById(id) : null;
  if (!category) {
    throw new AppError('Category not found', 404);
  }
  return category;
};

// Categories with their number of active products
const categoriesWithCounts = () =>
  Category.aggregate([
    {
      $lookup: {
        from: Product.collection.name,
        let: { categoryId: '$_id' },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$category', '$$categoryId'] }, { $eq: ['$isActive', true] }] } } }],
        as: 'products',
      },
    },
    { $addFields: { productCount: { $size: '$products' } } },
    { $project: { products: 0 } },
    { $sort: { name: 1 } },
  ]);

const listPage = async (req, res) => {
  const [categories, uncategorised] = await Promise.all([
    categoriesWithCounts(),
    Product.countDocuments({ category: null, isActive: true }),
  ]);
  res.render('categories/index', {
    title: 'Categories - StockSense',
    activeNav: 'categories',
    categories,
    uncategorised,
  });
};

const apiList = async (req, res) => {
  res.json({ success: true, data: { categories: await categoriesWithCounts() } });
};

const apiCreate = async (req, res) => {
  const category = await Category.create(cleanInput(req.body));
  res.status(201).json({ success: true, message: `Category ${category.name} created`, data: { category } });
};

const apiUpdate = async (req, res) => {
  const category = await findCategoryOr404(req.params.id);
  Object.assign(category, cleanInput(req.body));
  await category.save();
  res.json({ success: true, message: `Category ${category.name} updated`, data: { category } });
};

const apiDelete = async (req, res) => {
  const category = await findCategoryOr404(req.params.id);
  const [productCount, archivedCount] = await Promise.all([
    Product.countDocuments({ category: category._id }),
    Product.countDocuments({ category: category._id, isActive: false }),
  ]);
  if (productCount > 0) {
    const archivedNote = archivedCount ? ` (${archivedCount} archived)` : '';
    throw new AppError(`${category.name} still has ${productCount} product(s)${archivedNote}. Move them to another category first`, 409);
  }
  await category.deleteOne();
  res.json({ success: true, message: `Category ${category.name} deleted` });
};

module.exports = {
  listPage,
  apiList,
  apiCreate,
  apiUpdate,
  apiDelete,
};
