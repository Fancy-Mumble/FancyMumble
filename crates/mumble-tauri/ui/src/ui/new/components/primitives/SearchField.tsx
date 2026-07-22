import type { InputHTMLAttributes } from "react";
import { SearchIcon } from "@ui/icons";
import styles from "../../NewClientApp.module.css";

export default function SearchField(props: InputHTMLAttributes<HTMLInputElement>) {
  return <label className={styles.search}><SearchIcon /><input type="search" {...props} /></label>;
}
