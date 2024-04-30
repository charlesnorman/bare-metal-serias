#include "common-defines.h"
#include <libopencm3/stm32/memorymap.h>

#define BOOTLOADER_SIZE (0x8000U)
#define MAIN_APP_START_ADDRESS (FLASH_BASE + BOOTLOADER_SIZE)

static void jump_to_main(void)
{

  typedef void (*void_fn)(void);

  /*  This is the address of the reset entry pointer
      Will point to 0x8800 + 4.
      This is the address of the new address vector.
  */
  uint32_t *reset_vector_entry = (uint32_t *)(MAIN_APP_START_ADDRESS + 4U);

  /**
   * Dereference the pointer at 0x8800 + 4.
   * This will give us the address of the app program entry.
   * Store this address in the reset_vector pointer.
   */
  uint32_t *reset_vector = (uint32_t *)(*reset_vector_entry);

  void_fn jump_fn = (void_fn)reset_vector;

  jump_fn();
}

int main(void)
{

  jump_to_main();

  /* Never return*/
  return 0;
}