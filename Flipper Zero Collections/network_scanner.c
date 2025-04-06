#include <flipper_zero_sdk.h>
#include <network.h>

void scan_for_networks() {
    // Initialize network module
    net_init();

    // Start scanning for networks
    net_start_scan();

    while (true) {
        // Get the list of discovered networks
        net_network_t *networks = net_get_discovered_networks();
        
        // Print the discovered networks
        for (int i = 0; networks[i].ssid != NULL; i++) {
            printf("Network found: %s\n", networks[i].ssid);
        }

        // Sleep for a while before scanning again
        sleep(5);
    }

    // Stop scanning
    net_stop_scan();
}
