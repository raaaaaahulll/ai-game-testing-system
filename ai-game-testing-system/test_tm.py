import pygetwindow as gw
import psutil

def list_all():
    print("--- ALL WINDOW TITLES ---")
    titles = [t for t in gw.getAllTitles() if t.strip()]
    for t in sorted(titles):
        print(f"Window: '{t}'")
    
    print("\n--- ALL PROCESS NAMES ---")
    processes = set()
    for p in psutil.process_iter(['name']):
        try:
            processes.add(p.info['name'])
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    for n in sorted(list(processes)):
        print(f"Process: '{n}'")

if __name__ == "__main__":
    list_all()
