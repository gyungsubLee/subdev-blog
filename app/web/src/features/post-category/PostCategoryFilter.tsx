import Button from "../../components/button/Button";
import { ALL_CATEGORIES } from "./config";
import "./post-category.css";

type PostCategoryFilterProps = {
  category: string;
  categories: string[];
  onChange: (category: string) => void;
};

export default function PostCategoryFilter({
  category,
  categories,
  onChange,
}: PostCategoryFilterProps) {
  return (
    <div className="category-tabs" role="group" aria-label="카테고리">
      {[ALL_CATEGORIES, ...categories].map((name) => (
        <Button
          type="button"
          key={name}
          aria-pressed={category === name}
          onClick={() => onChange(name)}
        >
          {name}
        </Button>
      ))}
    </div>
  );
}
