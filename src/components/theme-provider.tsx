"use client"

import type React from "react"
import { createContext, useContext, useState, useEffect } from "react"

type Theme = "light" | "dark" | "system"

interface ThemeContextProps {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextProps>({
  theme: "system",
  setTheme: () => {},
})

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

export function ThemeProvider({ children, defaultTheme = "system", storageKey = "theme" }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const storedTheme = localStorage.getItem(storageKey) as Theme | null
      return storedTheme || defaultTheme
    } catch (e) {
      return defaultTheme
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, theme)
    } catch (e) {
      // Catch possible errors with localStorage (e.g., when quota is exceeded)
    }

    const getSystemTheme = () => {
      if (typeof window !== "undefined" && window.matchMedia) {
        return window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
      }
      return "light"
    }

    const applyTheme = () => {
      if (theme === "system") {
        const systemTheme = getSystemTheme()
        if (systemTheme === "dark") {
          document.documentElement.classList.add("dark")
          document.documentElement.style.colorScheme = "dark"
        } else {
          document.documentElement.classList.remove("dark")
          document.documentElement.style.colorScheme = "light"
        }
      } else if (theme === "dark") {
        document.documentElement.classList.add("dark")
        document.documentElement.style.colorScheme = "dark"
      } else {
        document.documentElement.classList.remove("dark")
        document.documentElement.style.colorScheme = "light"
      }
    }

    applyTheme()

    // Listen for system theme changes when theme is set to "system"
    if (theme === "system" && typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
      const handleChange = () => applyTheme()
      mediaQuery.addEventListener("change", handleChange)
      return () => mediaQuery.removeEventListener("change", handleChange)
    }
  }, [theme, storageKey])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}

